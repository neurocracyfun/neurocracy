pragma circom 2.1.6;
// Neurocracy round tally.
// Private: up to N vote leaves (wallet as two 128-bit halves, candidate index, raw balance at close)
//          and each leaf's weight.
// Public:  round, root (Poseidon Merkle root of the leaves), winner (candidate index),
//          totalsCommit (Poseidon hash chain of the C per-candidate totals, in candidate order).
// Proven:  every leaf is in the tree with that root; weight = floor(sqrt(raw)) for every leaf;
//          each candidate total is the sum of weights voting for it; the commitment matches those totals;
//          the winner's total is >= every other total. Padding leaves are all-zero (weight 0).
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template Tally(N, DEPTH, C) {
    signal input round;
    signal input root;
    signal input winner;
    signal input totalsCommit;

    signal input wHi[N]; signal input wLo[N]; signal input cand[N]; signal input raw[N]; signal input weight[N];

    // 1. leaves and Merkle root (binary Poseidon tree, N = 2^DEPTH)
    component leaf[N];
    for (var i = 0; i < N; i++) {
        leaf[i] = Poseidon(4);
        leaf[i].inputs[0] <== wHi[i]; leaf[i].inputs[1] <== wLo[i]; leaf[i].inputs[2] <== cand[i];
        leaf[i].inputs[3] <== raw[i];
    }
    component node[N - 1];
    var level[N]; for (var i = 0; i < N; i++) level[i] = leaf[i].out;
    var width = N; var k = 0;
    while (width > 1) {
        for (var i = 0; i < width / 2; i++) {
            node[k] = Poseidon(2); node[k].inputs[0] <== level[2 * i]; node[k].inputs[1] <== level[2 * i + 1];
            level[i] = node[k].out; k++;
        }
        width = width / 2;
    }
    root === level[0];

    // 2. weight = floor(sqrt(raw)): w*w <= raw < (w+1)*(w+1); raw < 2^62, weight < 2^31
    component wBits[N]; component lo[N]; component hi[N];
    signal sq[N]; signal sq1[N];
    for (var i = 0; i < N; i++) {
        wBits[i] = Num2Bits(31); wBits[i].in <== weight[i];
        sq[i] <== weight[i] * weight[i];
        sq1[i] <== sq[i] + 2 * weight[i] + 1;
        lo[i] = LessEqThan(64); lo[i].in[0] <== sq[i]; lo[i].in[1] <== raw[i]; lo[i].out === 1;
        hi[i] = LessThan(64); hi[i].in[0] <== raw[i]; hi[i].in[1] <== sq1[i]; hi[i].out === 1;
    }

    // 3. per-candidate totals; every leaf's candidate index must be < C
    component eq[N][C]; signal part[N][C]; signal acc[N + 1][C];
    component candOk[N];
    for (var c = 0; c < C; c++) acc[0][c] <== 0;
    for (var i = 0; i < N; i++) {
        candOk[i] = LessThan(8); candOk[i].in[0] <== cand[i]; candOk[i].in[1] <== C; candOk[i].out === 1;
        for (var c = 0; c < C; c++) {
            eq[i][c] = IsEqual(); eq[i][c].in[0] <== cand[i]; eq[i][c].in[1] <== c;
            part[i][c] <== eq[i][c].out * weight[i];
            acc[i + 1][c] <== acc[i][c] + part[i][c];
        }
    }

    // 4. commitment to the totals: h = Poseidon(round, total_0); h = Poseidon(h, total_c) ...
    component ch[C];
    for (var c = 0; c < C; c++) {
        ch[c] = Poseidon(2);
        ch[c].inputs[0] <== c == 0 ? round : ch[c - 1].out;
        ch[c].inputs[1] <== acc[N][c];
    }
    totalsCommit === ch[C - 1].out;

    // 5. winner has the largest total (ties allowed; the server breaks ties by ballot order)
    component wIs[C]; signal wTot[C + 1]; wTot[0] <== 0;
    component wOk = LessThan(8); wOk.in[0] <== winner; wOk.in[1] <== C; wOk.out === 1;
    for (var c = 0; c < C; c++) {
        wIs[c] = IsEqual(); wIs[c].in[0] <== winner; wIs[c].in[1] <== c;
        wTot[c + 1] <== wTot[c] + wIs[c].out * acc[N][c];
    }
    component ge[C];
    for (var c = 0; c < C; c++) { ge[c] = LessEqThan(40); ge[c].in[0] <== acc[N][c]; ge[c].in[1] <== wTot[C]; ge[c].out === 1; }
}
// 128 votes, 32 candidate slots
component main { public [round, root, winner, totalsCommit] } = Tally(128, 7, 32);
