use anchor_lang::prelude::*;

declare_id!("9AkR8DCaU3iNzqHJr7msGHULVgAcmB1i4MKPcQENEQP5");

#[program]
pub mod missing_signer {
    use super::*;

    /// Intentionally does not require `authority` to sign.
    pub fn log_message(ctx: Context<LogMessage>) -> Result<()> {
        msg!("GM {}", ctx.accounts.authority.key());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct LogMessage<'info> {
    /// CHECK: vulnerability — missing signer constraint
    pub authority: UncheckedAccount<'info>,
}
