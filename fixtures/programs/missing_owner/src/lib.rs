use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg, pubkey::Pubkey,
};

solana_program::declare_id!("7sDbfGBWkC5bMEUa9FYiQsAuSAJ2gqL2L54JkXgVNtQC");

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
    msg!(
        "touched {} lamports={} authority={}",
        data.key(),
        data.lamports(),
        authority.key
    );
    Ok(())
}
