use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg,
    program_error::ProgramError, pubkey::Pubkey,
};

solana_program::declare_id!("FdZRQCmitcGr8GtYaEKkgsxEFzGP7uhSvPRZDtGMr6Yp");

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    if accounts.is_empty() {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if !accounts[0].is_signer {
        msg!("authority must sign");
        return Err(ProgramError::MissingRequiredSignature);
    }
    msg!("GM {}", accounts[0].key);
    Ok(())
}
