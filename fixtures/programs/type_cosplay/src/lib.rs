use anchor_lang::prelude::*;

declare_id!("BncXyGyoM758eEbnsDnNc2T68u6g47gWD6osXg98JfXB");

#[program]
pub mod type_cosplay {
    use super::*;

    /// Intentionally accepts an UncheckedAccount instead of Account<User>.
    /// Missing discriminator / type check is the vulnerability (type cosplay).
    pub fn update_user(ctx: Context<UpdateUser>) -> Result<()> {
        let data = ctx.accounts.user.try_borrow_data()?;
        msg!(
            "accepted unchecked account {} len={} authority={}",
            ctx.accounts.user.key(),
            data.len(),
            ctx.accounts.authority.key()
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct UpdateUser<'info> {
    /// CHECK: vulnerability — should be Account<User> with discriminator
    /// CHECK: intentionally unchecked / no owner or type validation
    pub user: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
}
