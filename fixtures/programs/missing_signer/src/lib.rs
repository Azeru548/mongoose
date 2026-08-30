#![no_std]
use pinocchio::{
    account_info::AccountInfo, entrypoint, msg, pubkey::Pubkey, ProgramResult,
};

pinocchio_pubkey::declare_id!("9AkR8DCaU3iNzqHJr7msGHULVgAcmB1i4MKPcQENEQP5");

entrypoint!(process_instruction);
pinocchio::default_panic_handler!();

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Intentionally does NOT check is_signer — vulnerability
    if accounts.is_empty() {
        return Ok(());
    }
    msg!("GM");
    Ok(())
}
