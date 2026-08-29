use anchor_lang::prelude::*;

declare_id!("FdZRQCmitcGr8GtYaEKkgsxEFzGP7uhSvPRZDtGMr6Yp");

#[program]
pub mod missing_signer_secure {
    use super::*;

    pub fn log_message(ctx: Context<LogMessage>) -> Result<()> {
        require!(ctx.accounts.authority.is_signer, SignerError::MissingSig);
        msg!("GM {}", ctx.accounts.authority.key());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct LogMessage<'info> {
    /// CHECK: control fixture — signer enforced in handler
    pub authority: UncheckedAccount<'info>,
}

#[error_code]
pub enum SignerError {
    #[msg("authority must sign")]
    MissingSig,
}
