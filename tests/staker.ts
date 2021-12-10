const assert = require("assert");
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { Staker } from '../target/types/staker';
import { 
  PublicKey, 
  Keypair, 
  LAMPORTS_PER_SOL,     
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, Token } from "@solana/spl-token";

const createMint = async (provider:anchor.Provider, authority: Keypair) : Promise<Token> => {
  return await Token.createMint(
    provider.connection,
    authority,
    authority.publicKey,
    null,
    0,
    TOKEN_PROGRAM_ID
  );
}

const createMintUserAccount = async(mint: Token, userPublicKey: PublicKey): Promise<PublicKey> => {
  return  await mint.createAccount(userPublicKey);
}

const getTokenBalance = async (pubkey: PublicKey, provider:anchor.Provider) => {
  return parseInt(
    (await provider.connection.getTokenAccountBalance(pubkey)).value.amount
  );
};

const airdrop = async(provider:anchor.Provider, receipt: PublicKey, lamports: number) => {
  // Airdropping tokens to a receipt.
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(receipt, lamports),
    "confirmed"
  );

  const lamports_owned = await provider.connection.getBalance(receipt)
  console.log(
    'Account', receipt.toBase58(),
    'containing', lamports_owned / LAMPORTS_PER_SOL, 'SOL to pay for fees',
  )  
}

describe('staker', async () => {
  // Configure the client to use the local cluster.  
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  let usdc : Token;
  let vault : PublicKey;
  let programSigner: PublicKey;
  let nonce: number;
  let alice_usdc_account: PublicKey;

  const payer = Keypair.generate();
  const alice = Keypair.generate();
  const pool = Keypair.generate();
  const program = anchor.workspace.Staker as Program<Staker>;

  // const amount = new anchor.BN(5 * 10 ** 6)
  const amount = 50;
  before(() => {
    return new Promise((resolve) => {
      setTimeout(async () => {
        await airdrop(provider, payer.publicKey, 10000000000);
        await airdrop(provider, alice.publicKey, 10000000000);
    
        usdc = await createMint(provider, payer);
    
        // program signer PDA - sign transactions for the program
        [programSigner, nonce] = await anchor.web3.PublicKey.findProgramAddress(
          [pool.publicKey.toBuffer()],
          program.programId
        );

        vault = await createMintUserAccount(usdc, programSigner);

        console.log("Program ID from JS: ", program.programId.toBase58());
    
        alice_usdc_account = await createMintUserAccount(usdc, alice.publicKey);
        await usdc.mintTo(alice_usdc_account, payer, [], amount);

        console.log("Alice usdc balance: ", await getTokenBalance(alice_usdc_account,provider));
        resolve(1);
      }, 1);
    });
  });

  it('Initialize pool state', async () => {
    console.log("program signer:", programSigner.toBase58());

    const tx = await program.rpc.initializePool(nonce, {
      accounts: {
        pool: pool.publicKey,
        mint: usdc.publicKey,
        vault: vault,
        programSigner
      },
      signers: [pool],
      preInstructions: [
        await program.account.pool.createInstruction(pool)  // size can be overridden
      ],
    });

    console.log("Initialize transaction signature", tx);
  });

  it('Should fail if deposit without signer', async () => {
    try {
      await program.rpc.deposit(new anchor.BN(amount), {
        accounts: {
          pool: pool.publicKey,
          mint: usdc.publicKey,
          vault,
          // programSigner,
          userMintAcc: alice_usdc_account,
          userAuthority: alice.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
        },
        // signers: [alice],
      })
      
      assert.ok(false);
    } catch (err) {
      assert.ok(true);
      console.log("error code",err)
    }
  })

  it('Should deposit', async () => {
    const tx = await program.rpc.deposit(new anchor.BN(amount), {
      accounts: {
        pool: pool.publicKey,
        mint: usdc.publicKey,
        vault,
        // programSigner,
        userMintAcc: alice_usdc_account,
        userAuthority: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
      },
      signers: [alice],
    })

    console.log("Deposit transaction signature", tx);
    console.log("Alice usdc balance: ", await getTokenBalance(alice_usdc_account,provider));
    console.log("Vault usdc balance: ", await getTokenBalance(vault,provider));
  })

  it('Should withdraw', async () => {
    const tx = await program.rpc.withdraw(new anchor.BN(amount), {
      accounts: {
        pool: pool.publicKey,
        mint: usdc.publicKey,
        vault,
        programSigner,
        userMintAcc: alice_usdc_account,
        userAuthority: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
      },
      signers: [alice],
    })

    console.log("Withdraw transaction signature", tx);
    console.log("Alice usdc balance: ", await getTokenBalance(alice_usdc_account,provider));
    console.log("Vault usdc balance: ", await getTokenBalance(vault,provider));
  })

});

