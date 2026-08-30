#![no_std]
use pinocchio::{
    account_info::AccountInfo, entrypoint, msg, pubkey::Pubkey, ProgramResult,
};

pinocchio_pubkey::declare_id!("7sDbfGBWkC5bMEUa9FYiQsAuSAJ2gqL2L54JkXgVNtQC");

entrypoint!(process_instruction);


pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Intentionally does NOT verify data is owned by this program — vulnerability
    if accounts.len() < 2 {
        return Ok(());
    }
    let data = &accounts[0];
    let authority = &accounts[1];
    msg!("touched");
    let _ = (data.key(), unsafe { data.borrow_lamports_unchecked() }, authority.key());
    Ok(())
}
