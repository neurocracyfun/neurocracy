// Host-side check: the bytes produced by lib/zkchain.js encode() verify with groth16-solana.
// Regenerate the sample with: node scripts/zk-dump.js program/tests/sample.bin
use groth16_solana::groth16::Groth16Verifier;
#[path = "../src/vk.rs"] mod vk;
#[test]
fn sample_proof_verifies_and_tamper_fails() {
    let d = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/sample.bin")).unwrap();
    let a: [u8; 64] = d[1..65].try_into().unwrap(); let b: [u8; 128] = d[65..193].try_into().unwrap(); let c: [u8; 64] = d[193..257].try_into().unwrap();
    let mut inp = [[0u8; 32]; vk::NR_INPUTS]; for i in 0..vk::NR_INPUTS { inp[i] = d[257 + 32 * i..289 + 32 * i].try_into().unwrap(); }
    let mut v = Groth16Verifier::new(&a, &b, &c, &inp, &vk::VERIFYING_KEY).unwrap();
    assert!(v.verify().is_ok(), "valid proof must verify");
    inp[2][31] ^= 1; let mut v2 = Groth16Verifier::new(&a, &b, &c, &inp, &vk::VERIFYING_KEY).unwrap();
    assert!(v2.verify().is_err(), "tampered winner must fail");
}
