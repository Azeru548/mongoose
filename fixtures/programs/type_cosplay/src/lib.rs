use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg, pubkey::Pubkey,
};

solana_program::declare_id!("BncXyGyoM758eEbnsDnNc2T68u6g47gWD6osXg98JfXB");

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Intentionally accepts any AccountInfo without discriminator check — type cosplay
    if accounts.len() < 2 {
        return Ok(());
    }
    let user = &accounts[0];
    let authority = &accounts[1];
    // Simulate try_borrow_data without type check
    let data = user.try_borrow_data()?;
    msg!(
        "accepted unchecked account {} len={} authority={}",
        user.key,
        data.len(),
        authority.key
    );
    Ok(())
}
