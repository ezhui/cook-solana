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

const createMintUserAccount = async(mint: Token, owner: PublicKey): Promise<PublicKey> => {
  return  await mint.createAccount(owner);
}

const createMintAssociateAccount = async(mint: Token, owner: PublicKey): Promise<PublicKey> => {
  return  await mint.createAssociatedTokenAccount(owner);
}

const getTokenBalance = async (pubkey: PublicKey, provider:anchor.Provider) => {
  return parseInt(
    (await provider.connection.getTokenAccountBalance(pubkey)).value.amount
  );
};

const getSolBalance = async(provider:anchor.Provider, receipt: PublicKey) => {
  const lamports = await provider.connection.getBalance(receipt)
  console.log(
    'Account', receipt.toBase58(),
    'containing', lamports / LAMPORTS_PER_SOL, 'SOL to pay for fees',
  )  
}

const airdrop = async(provider:anchor.Provider, receipt: PublicKey, lamports: number) => {
  // Airdropping tokens to a receipt.
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(receipt, lamports),
    "confirmed"
  );

  await getSolBalance(provider, receipt);
}

const createProgramAssociateAccount = async(owner: PublicKey, programId: PublicKey) => {
  return (await anchor.web3.PublicKey.findProgramAddress([owner.toBuffer(), programId.toBuffer()], programId))[0];    
}

describe('staker', async () => {
  // Configure the client to use the local cluster.  
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  let usdc : Token;
  let vault : PublicKey;
  let programSigner: PublicKey;
  let nonce: number;
  let aliceUSDCAccount: PublicKey;

  const usdcOwner = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const pool = Keypair.generate();
  const program = anchor.workspace.Staker as Program<Staker>;

  const amount = 50;
  before(() => {
    return new Promise((resolve) => {
      setTimeout(async () => {
        await airdrop(provider, usdcOwner.publicKey, 10000000000);
        await airdrop(provider, alice.publicKey, 10000000000);
        await airdrop(provider, bob.publicKey, 10000000000);
    
        usdc = await createMint(provider, usdcOwner);
    
        // program signer PDA - sign transactions for the program
        [programSigner, nonce] = await anchor.web3.PublicKey.findProgramAddress(
          [pool.publicKey.toBuffer()],
          program.programId
        );

        vault = await createMintUserAccount(usdc, programSigner);

        console.log("Program ID from JS: ", program.programId.toBase58());
    
        aliceUSDCAccount = await createMintUserAccount(usdc, alice.publicKey);
        await usdc.mintTo(aliceUSDCAccount, usdcOwner, [], amount);

        console.log("Alice usdc balance: ", await getTokenBalance(aliceUSDCAccount,provider));
        resolve(1);
      }, 1);
    });
  });

  it('Initialize pool state', async () => {
    console.log("program signer:", programSigner.toBase58());

    await getSolBalance(provider, provider.wallet.publicKey);

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

    await getSolBalance(provider, provider.wallet.publicKey);
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
          userMintAcc: aliceUSDCAccount,
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
        userMintAcc: aliceUSDCAccount,
        userAuthority: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
      },
      signers: [alice],
    })

    console.log("Deposit transaction signature", tx);
    console.log("Alice usdc balance: ", await getTokenBalance(aliceUSDCAccount,provider));
    console.log("Vault usdc balance: ", await getTokenBalance(vault,provider));
  })

  it('Should fail if withdraw without signer', async () => {
    try {
      await program.rpc.withdraw(new anchor.BN(amount), {
        accounts: {
          pool: pool.publicKey,
          mint: usdc.publicKey,
          vault,
          programSigner,
          userMintAcc: aliceUSDCAccount,
          userAuthority: alice.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
        },
        signers: [],
      })
      assert.ok(false);
    } catch (error) {
      assert.ok(true);
    }
  })

  it('Should fail if withdraw with invalid signer', async () => {
    try {
      await program.rpc.withdraw(new anchor.BN(amount), {
        accounts: {
          pool: pool.publicKey,
          mint: usdc.publicKey,
          vault,
          programSigner,
          userMintAcc: aliceUSDCAccount,
          userAuthority: alice.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
        },
        signers: [bob],
      })
      assert.ok(false);
    } catch (error) {
      assert.ok(true);
    }
  })

  it('Should withdraw', async () => {
    const tx = await program.rpc.withdraw(new anchor.BN(amount), {
      accounts: {
        pool: pool.publicKey,
        mint: usdc.publicKey,
        vault,
        programSigner,
        userMintAcc: aliceUSDCAccount,
        userAuthority: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
      },
      signers: [alice],
    })

    console.log("Withdraw transaction signature", tx);
    console.log("Alice usdc balance: ", await getTokenBalance(aliceUSDCAccount,provider));
    console.log("Vault usdc balance: ", await getTokenBalance(vault,provider));
  })

  it('Token associate account', async () => {
    // Random usdc account for Alice
    let acc1 = await createMintUserAccount(usdc, alice.publicKey);
    let acc2 = await createMintUserAccount(usdc, alice.publicKey);
    console.log("Acc 1", acc1.toBase58())
    console.log("Acc 2", acc2.toBase58())

    assert.ok(!acc1.equals(acc2));

    // Deterministic usdc account for Alice
    acc1 = await usdc.createAssociatedTokenAccount(alice.publicKey);
    try {
      // Associate account can't be created twice
      acc2 = await usdc.createAssociatedTokenAccount(alice.publicKey);
      assert.ok(false);
    } catch (error) {
      assert.ok(true);
    }

    // But we can get or create the associate account
    let acc3 = await usdc.getOrCreateAssociatedAccountInfo(alice.publicKey);
    assert.ok(!acc2.equals(acc3.address));
  })

  it('Generate associate account for our own program and user', async() => {
    let acc1 = await createProgramAssociateAccount(alice.publicKey, program.programId);
    let acc2 = await createProgramAssociateAccount(alice.publicKey, program.programId);

    assert.ok(acc1.equals(acc2));

    console.log("Program associated account: ", acc1.toBase58());
  })
});

