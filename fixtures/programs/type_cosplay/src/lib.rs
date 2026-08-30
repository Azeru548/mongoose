#![no_std]
use pinocchio::{
    account_info::AccountInfo, entrypoint, msg, pubkey::Pubkey, ProgramResult,
};

pinocchio_pubkey::declare_id!("BncXyGyoM758eEbnsDnNc2T68u6g47gWD6osXg98JfXB");

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
    let data = unsafe { user.borrow_data_unchecked() };
    msg!("accepted unchecked account");
    let _ = (user.key(), data.len(), authority.key());
    Ok(())
}
