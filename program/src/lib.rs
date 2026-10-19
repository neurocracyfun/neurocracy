//! Neurocracy tally verifier.
//!
//! One instruction: `record_tally`. It checks a Groth16 proof (circuit zk/tally.circom) that a round's
//! winner and per-candidate totals follow from the votes committed in a Poseidon Merkle root, then
//! stores the result in a PDA at seeds ["tally", authority, round_le]. The authority (the signer that
//! pays) is part of the seeds, so nobody can occupy another publisher's record; readers look up the
//! records of the site's published authority. A record is written once and never changed.
//!
//! Instruction data (385 bytes): tag u8 = 0 | proof_a 64 | proof_b 128 | proof_c 64 |
//!   public inputs 4 x 32 (round, root, winner, totals_commit; big-endian field elements).
//!   proof_a must be negated (standard for groth16-solana).
//! Accounts: [signer, writable] authority, [writable] record PDA, [] system program.
//! Record data (117 bytes): version u8 | round u64 | root 32 | winner u32 | totals_commit 32 |
//!   slot u64 | authority 32 (the authority is also in the seeds).
use groth16_solana::groth16::Groth16Verifier;
use solana_program::{
    account_info::{next_account_info, AccountInfo}, clock::Clock, entrypoint::ProgramResult, msg,
    program::invoke_signed, program_error::ProgramError, pubkey::Pubkey, rent::Rent, system_instruction,
    system_program, sysvar::Sysvar,
};
mod vk;
pub const RECORD_LEN: usize = 1 + 8 + 32 + 4 + 32 + 8 + 32; // 117

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

fn be_u64(x: &[u8; 32]) -> Result<u64, ProgramError> {
    if x[..24].iter().any(|b| *b != 0) { return Err(ProgramError::InvalidInstructionData); }
    Ok(u64::from_be_bytes(x[24..].try_into().unwrap()))
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 1 + 64 + 128 + 64 + 128 || data[0] != 0 { return Err(ProgramError::InvalidInstructionData); }
    let proof_a: [u8; 64] = data[1..65].try_into().unwrap();
    let proof_b: [u8; 128] = data[65..193].try_into().unwrap();
    let proof_c: [u8; 64] = data[193..257].try_into().unwrap();
    let mut inputs = [[0u8; 32]; vk::NR_INPUTS];
    for i in 0..vk::NR_INPUTS { inputs[i] = data[257 + 32 * i..289 + 32 * i].try_into().unwrap(); }

    let it = &mut accounts.iter();
    let authority = next_account_info(it)?; let record = next_account_info(it)?; let system = next_account_info(it)?;
    if !authority.is_signer { return Err(ProgramError::MissingRequiredSignature); }
    if *system.key != system_program::ID { return Err(ProgramError::IncorrectProgramId); }

    let round = be_u64(&inputs[0])?;
    let winner = be_u64(&inputs[2])? as u32;
    let round_le = round.to_le_bytes();
    let (pda, bump) = Pubkey::find_program_address(&[b"tally", authority.key.as_ref(), &round_le], program_id);
    if pda != *record.key { return Err(ProgramError::InvalidSeeds); }
    if record.lamports() > 0 || !record.data_is_empty() { msg!("round already recorded"); return Err(ProgramError::AccountAlreadyInitialized); }

    let mut v = Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &inputs, &vk::VERIFYING_KEY).map_err(|_| ProgramError::InvalidInstructionData)?;
    v.verify().map_err(|_| { msg!("proof rejected"); ProgramError::InvalidArgument })?;

    let rent = Rent::get()?.minimum_balance(RECORD_LEN);
    invoke_signed(&system_instruction::create_account(authority.key, record.key, rent, RECORD_LEN as u64, program_id),
        &[authority.clone(), record.clone(), system.clone()], &[&[b"tally", authority.key.as_ref(), &round_le, &[bump]]])?;
    let mut d = record.try_borrow_mut_data()?;
    d[0] = 1; d[1..9].copy_from_slice(&round_le); d[9..41].copy_from_slice(&inputs[1]);
    d[41..45].copy_from_slice(&winner.to_le_bytes()); d[45..77].copy_from_slice(&inputs[3]);
    d[77..85].copy_from_slice(&Clock::get()?.slot.to_le_bytes()); d[85..117].copy_from_slice(authority.key.as_ref());
    msg!("tally recorded: round {} winner {}", round, winner);
    Ok(())
}
