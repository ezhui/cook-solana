use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Transfer};
use std::cell::RefMut;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod staker {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>, nonce: u8) -> ProgramResult {
        let pool = &mut ctx.accounts.pool;

        pool.mint = *ctx.accounts.mint.key;
        pool.vault = *ctx.accounts.vault.to_account_info().key;
        if ctx.accounts.vault.mint !=  pool.mint {
            return Err(PoolError::InvalidVaultAccount.into());
        }

        if ctx.accounts.vault.owner != *ctx.accounts.program_signer.key {
            return Err(PoolError::InvalidVaultAccount.into());
        }

        pool.program_signer = *ctx.accounts.program_signer.key;
        pool.nonce = nonce;

        pool.amount = 0;
        pool.user = Pubkey::default();

        pool.initialized = true;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> ProgramResult {
        if amount == 0 {
            return Err(PoolError::InvalidDepositAmount.into());
        }

        let pool = &mut ctx.accounts.pool;
        if !pool.initialized {
            return Err(PoolError::NotInitialized.into());
        }

        msg!("User mint acc owner is: {}", ctx.accounts.user_mint_acc.owner.to_string());

        // Transfer usdc from user account to vault
        let transfer_ctx = CpiContext::new(ctx.accounts.token_program.clone(), Transfer {
            from: ctx.accounts.user_mint_acc.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user_authority.to_account_info()
        });
        token::transfer(transfer_ctx, amount)?;

        pool.amount = amount;
        pool.user = *ctx.accounts.user_authority.key;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> ProgramResult {
        let pool = &ctx.accounts.pool;
        if !pool.initialized {
            return Err(PoolError::NotInitialized.into());
        }

        if amount > pool.amount {
            return Err(PoolError::InvalidWithdrawAmount.into());
        }

        if !ctx.accounts.user_authority.key.eq(&pool.user) {
            return Err(PoolError::InvalidWithdrawUser.into());
        }

        // Transfer usdc from vault to user account
        let seeds = &[
            ctx.accounts.pool.to_account_info().key.as_ref(),
            &[ctx.accounts.pool.nonce],
        ];

        msg!("Program id is: {}", ctx.program_id.to_string());
        msg!("Vault owner is: {}", ctx.accounts.vault.owner.to_string());

        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.clone(), Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user_mint_acc.to_account_info(),
            authority: ctx.accounts.program_signer.to_account_info()
        }, signer);

        token::transfer(transfer_ctx, amount)?;

        let pool = &mut ctx.accounts.pool;
        pool.amount -= amount;

        Ok(())
    }

    pub fn initialize_associate_account(ctx: Context<InitializeAssociateAccount>) -> ProgramResult {
        // if ctx.accounts.associate_account.owner.key() != ctx.accounts.owner.key() {
        //     return Err(PoolError::InvalidAssociateAccountOwner.into());
        // }

        Ok(())
    }

    pub fn write_account_unsafe(ctx: Context<InitializeAccountUnsafe>, magic: u64) -> ProgramResult {
        let order_acc = ctx.accounts.order.to_account_info();

        let order_ptr = match order_acc.try_borrow_mut_data() {
            Ok(p) => RefMut::map(p, |data| *data).as_mut_ptr(),
            Err(_) => return Err(PoolError::InvalidOrderAccount.into()),
        };

        let order_hdr =  match unsafe { order_ptr.cast::<OrderHeader>().as_mut() } {
            Some(v) => v,
            None => return Err(PoolError::InvalidOrderAccount.into()),
        };

        order_hdr.magic = magic;

        if magic == 0x55 {
            return Err(PoolError::InvalidOrderAccount.into())
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(zero)]
    pub pool: Account<'info, Pool>,
    pub mint: AccountInfo<'info>,

    #[account("vault.owner == *program_signer.key")]
    #[account("vault.mint == *mint.key")]
    #[account("&vault.owner == &Pubkey::find_program_address(&[&pool.to_account_info().key.to_bytes()], &program_id).0")]
    pub vault: Account<'info, TokenAccount>,
    pub program_signer: AccountInfo<'info>
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, has_one = vault @ PoolError::InvalidPool)]
    pub pool: Account<'info, Pool>,

    pub mint: AccountInfo<'info>,

    #[account(mut)]
    vault: Account<'info, TokenAccount>,

    #[account(mut, "user_mint_acc.owner == *user_authority.key && user_mint_acc.mint == *mint.key")]
    user_mint_acc: Account<'info, TokenAccount>,

    #[account(signer @PoolError::MissUserSignature)]
    pub user_authority: AccountInfo<'info>,

    #[account(executable, "token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = vault @ PoolError::InvalidPool)]
    pub pool: Account<'info, Pool>,

    pub mint: AccountInfo<'info>,

    #[account(mut)]
    vault: Account<'info, TokenAccount>,

    #[account(
        seeds = [pool.to_account_info().key.as_ref()],
        bump = pool.nonce,
    )]
    #[account("*program_signer.key == pool.program_signer")]
    program_signer: AccountInfo<'info>,

    #[account(mut, "user_mint_acc.owner == *user_authority.key && user_mint_acc.mint == *mint.key")]
    user_mint_acc: Account<'info, TokenAccount>,

    #[account(signer @ PoolError::MissUserSignature)]
    pub user_authority: AccountInfo<'info>,

    #[account(executable, "token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
}

#[account]
pub struct Pool {
    /// Initialized
    pub initialized: bool,
    ///  
    pub program_signer: Pubkey,
    /// The mint of the SPL token locked up.
    pub mint: Pubkey,
    /// Address of the account's token vault.
    pub vault: Pubkey,
    /// Signer nonce.
    pub nonce: u8,

    /// Deposited user and amount
    pub user: Pubkey,
    pub amount: u64
}

#[derive(Accounts)]
pub struct InitializeAssociateAccount<'info> {
    // #[account(zero)]
    pub associate_account: Account<'info, OpenOrder>,

    // #[account(signer)]
    pub owner: AccountInfo<'info>
}

#[account]
pub struct OpenOrder{}

#[error]
pub enum PoolError {
    #[msg("Invalid pool account.")]
    InvalidPool,
    #[msg("Not initialized.")]
    NotInitialized,
    #[msg("Invalid deposit amount.")]
    InvalidDepositAmount,
    #[msg("Miss user signature.")]
    MissUserSignature,
    #[msg("Invalid withdraw amount.")]
    InvalidWithdrawAmount,
    #[msg("Invalid withdraw user.")]
    InvalidWithdrawUser,
    #[msg("Invalid vault account.")]
    InvalidVaultAccount,
    #[msg("Invalid associate account owner.")]
    InvalidAssociateAccountOwner,
    #[msg("Invalid associate account owner.")]
    InvalidOrderAccount  
      
}

#[derive(Accounts)]
pub struct InitializeAccountUnsafe<'info> {
    #[account(mut)]
    pub order: AccountInfo<'info>,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct OrderHeader {
    magic: u64,
}
