use anchor_lang::prelude::*;

declare_id!("7sDbfGBWkC5bMEUa9FYiQsAuSAJ2gqL2L54JkXgVNtQC");

#[program]
pub mod missing_owner {
    use super::*;

    /// Intentionally does not verify `data` is owned by this program.
    pub fn touch(ctx: Context<Touch>) -> Result<()> {
        let data = &ctx.accounts.data;
        msg!("touched {} lamports={}", data.key(), data.lamports());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Touch<'info> {
    /// CHECK: vulnerability — missing owner constraint
    pub data: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
}
