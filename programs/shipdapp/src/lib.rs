use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

declare_id!("vSngxpkHdGeimmsppeGksGZ6srXAaWDKKQxXeHAhpRF");

#[program]
pub mod shipdapp {
    use super::*;

    pub fn initialize_platform(ctx: Context<InitPlatform>) -> Result<()> {
        ctx.accounts.platform_config.authority = ctx.accounts.authority.key();
        ctx.accounts.platform_config.app_count = 0;
        ctx.accounts.platform_config.bump = ctx.bumps.platform_config;
        Ok(())
    }

    pub fn launch_app(
        ctx: Context<LaunchApp>,
        name: String,
        description: String,
        docker_image: String,
    ) -> Result<()> {
        require!(name.len() <= 50, ShipDappError::NameTooLong);
        require!(description.len() <= 200, ShipDappError::DescriptionTooLong);
        require!(docker_image.len() <= 300, ShipDappError::ImageUriTooLong);

        let app = &mut ctx.accounts.app_state;
        let clock = Clock::get()?;

        app.creator = ctx.accounts.creator.key();
        app.token_mint = ctx.accounts.token_mint.key();
        app.hosting_vault = ctx.accounts.hosting_vault.key();
        app.name = name;
        app.description = description;
        app.docker_image = docker_image;
        app.app_url = String::new();
        app.status = AppStatus::Deploying;
        app.created_at = clock.unix_timestamp;
        app.last_funded_at = clock.unix_timestamp;
        app.total_fees_collected = 0;
        app.bump = ctx.bumps.app_state;

        let config = &mut ctx.accounts.platform_config;
        config.app_count += 1;

        emit!(AppLaunched {
            app: app.key(),
            creator: app.creator,
            token_mint: app.token_mint,
            docker_image: app.docker_image.clone(),
            name: app.name.clone(),
        });

        Ok(())
    }

    pub fn set_app_live(ctx: Context<UpdateApp>, app_url: String) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.platform_config.authority,
            ShipDappError::Unauthorized
        );

        let app = &mut ctx.accounts.app_state;
        app.app_url = app_url;
        app.status = AppStatus::Active;

        emit!(AppLive {
            app: app.key(),
            app_url: app.app_url.clone(),
        });

        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        require!(amount > 0, ShipDappError::InvalidAmount);

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.donor.key(),
            &ctx.accounts.hosting_vault.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.donor.to_account_info(),
                ctx.accounts.hosting_vault.to_account_info(),
            ],
        )?;

        let app = &mut ctx.accounts.app_state;
        app.total_fees_collected += amount;
        app.last_funded_at = Clock::get()?.unix_timestamp;

        emit!(DonationReceived {
            app: app.key(),
            donor: ctx.accounts.donor.key(),
            amount,
        });

        Ok(())
    }

    pub fn withdraw_for_hosting(ctx: Context<WithdrawHosting>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.platform_config.authority,
            ShipDappError::Unauthorized
        );

        let vault = &ctx.accounts.hosting_vault;
        let rent = Rent::get()?.minimum_balance(0);
        let available = vault
            .lamports()
            .checked_sub(rent)
            .ok_or(ShipDappError::InsufficientFunds)?;
        require!(amount <= available, ShipDappError::InsufficientFunds);

        **ctx.accounts.hosting_vault.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.try_borrow_mut_lamports()? += amount;

        emit!(HostingWithdrawal {
            app: ctx.accounts.app_state.key(),
            amount,
        });

        Ok(())
    }

    pub fn pause_app(ctx: Context<UpdateApp>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.platform_config.authority,
            ShipDappError::Unauthorized
        );
        ctx.accounts.app_state.status = AppStatus::Paused;

        emit!(AppPaused {
            app: ctx.accounts.app_state.key(),
        });

        Ok(())
    }

    pub fn resume_app(ctx: Context<UpdateApp>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.platform_config.authority,
            ShipDappError::Unauthorized
        );
        require!(
            ctx.accounts.app_state.status == AppStatus::Paused,
            ShipDappError::InvalidStatus
        );
        ctx.accounts.app_state.status = AppStatus::Active;
        Ok(())
    }
}

// ── Accounts ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitPlatform<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PlatformConfig::MAX_SIZE,
        seeds = [b"platform"],
        bump
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct LaunchApp<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + AppState::MAX_SIZE,
        seeds = [b"app", creator.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub app_state: Account<'info, AppState>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: PDA that holds SOL for hosting payments
    #[account(
        seeds = [b"vault", app_state.key().as_ref()],
        bump
    )]
    pub hosting_vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"platform"],
        bump = platform_config.bump
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateApp<'info> {
    #[account(mut)]
    pub app_state: Account<'info, AppState>,

    #[account(seeds = [b"platform"], bump = platform_config.bump)]
    pub platform_config: Account<'info, PlatformConfig>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub app_state: Account<'info, AppState>,

    /// CHECK: vault PDA
    #[account(
        mut,
        seeds = [b"vault", app_state.key().as_ref()],
        bump
    )]
    pub hosting_vault: SystemAccount<'info>,

    #[account(mut)]
    pub donor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawHosting<'info> {
    #[account(mut)]
    pub app_state: Account<'info, AppState>,

    /// CHECK: vault PDA
    #[account(
        mut,
        seeds = [b"vault", app_state.key().as_ref()],
        bump
    )]
    pub hosting_vault: SystemAccount<'info>,

    #[account(seeds = [b"platform"], bump = platform_config.bump)]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

// ── State ─────────────────────────────────────────────────────────────────────

#[account]
pub struct AppState {
    pub creator: Pubkey,
    pub token_mint: Pubkey,
    pub hosting_vault: Pubkey,
    pub name: String,
    pub description: String,
    pub docker_image: String,
    pub app_url: String,
    pub status: AppStatus,
    pub created_at: i64,
    pub last_funded_at: i64,
    pub total_fees_collected: u64,
    pub bump: u8,
}

impl AppState {
    // 32 + 32 + 32 + (4+50) + (4+200) + (4+300) + (4+200) + 1 + 8 + 8 + 8 + 1 = 888
    pub const MAX_SIZE: usize = 32 + 32 + 32 + 54 + 204 + 304 + 204 + 1 + 8 + 8 + 8 + 1;
}

#[account]
pub struct PlatformConfig {
    pub authority: Pubkey,
    pub app_count: u64,
    pub bump: u8,
}

impl PlatformConfig {
    pub const MAX_SIZE: usize = 32 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AppStatus {
    Deploying,
    Active,
    Paused,
    Dead,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct AppLaunched {
    pub app: Pubkey,
    pub creator: Pubkey,
    pub token_mint: Pubkey,
    pub docker_image: String,
    pub name: String,
}

#[event]
pub struct AppLive {
    pub app: Pubkey,
    pub app_url: String,
}

#[event]
pub struct DonationReceived {
    pub app: Pubkey,
    pub donor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct HostingWithdrawal {
    pub app: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AppPaused {
    pub app: Pubkey,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum ShipDappError {
    #[msg("App name must be 50 characters or less")]
    NameTooLong,
    #[msg("Description must be 200 characters or less")]
    DescriptionTooLong,
    #[msg("Docker image URI must be 300 characters or less")]
    ImageUriTooLong,
    #[msg("Only platform authority can perform this action")]
    Unauthorized,
    #[msg("Insufficient funds in hosting vault")]
    InsufficientFunds,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Invalid app status for this operation")]
    InvalidStatus,
}
