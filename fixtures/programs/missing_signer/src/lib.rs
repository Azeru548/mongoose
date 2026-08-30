use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg, pubkey::Pubkey,
};

solana_program::declare_id!("9AkR8DCaU3iNzqHJr7msGHULVgAcmB1i4MKPcQENEQP5");

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Intentionally does NOT require authority to sign — vulnerability
    if accounts.is_empty() {
        return Ok(());
    }
    msg!("GM {}", accounts[0].key);
    Ok(())
}
