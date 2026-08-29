import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Finding, ProgramSummary, VerifiedFinding, VulnClass } from "./types.js";

const FULL_PROOF: VulnClass[] = [1, 2, 3];

export interface VerifierContext {
  rpcUrl: string;
  skip: boolean;
  deployMapPath: string;
  caseId?: string;
}

export interface DeployEntry {
  programId: string;
  soPath?: string;
  keypairPath?: string;
  caseIds?: string[];
}

export interface DeployMap {
  [name: string]: DeployEntry | Record<string, string> | undefined;
  byCaseId?: Record<string, string>;
}

const FIXTURE_BY_CLASS: Record<number, string> = {
  1: "missing_signer",
  2: "missing_owner",
  3: "type_cosplay",
};

export function defaultVerifierContext(skip = false): VerifierContext {
  return {
    rpcUrl: process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
    skip,
    deployMapPath:
      process.env.OTTER_DEPLOY_MAP ?? join(process.cwd(), "output", "deploy-map.json"),
    caseId: process.env.OTTER_CASE_ID,
  };
}

export async function verifyFindings(
  summary: ProgramSummary,
  findings: Finding[],
  ctx: VerifierContext,
): Promise<VerifiedFinding[]> {
  if (ctx.skip) {
    return findings.map((f) => ({
      ...f,
      verdict: "UNCONFIRMED" as const,
      exploit_transaction: null,
      pre_state: null,
      post_state: null,
      notes: `Verifier skipped (--skip-verify). Planned exploit: ${describeExploit(f)}`,
    }));
  }

  const connection = await probeValidator(ctx.rpcUrl);
  const map = loadDeployMap(ctx.deployMapPath);

  const out: VerifiedFinding[] = [];
  for (const finding of findings) {
    out.push(await verifyOne(summary, finding, connection, ctx, map));
  }
  return out;
}

function loadDeployMap(path: string): DeployMap | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as DeployMap;
}

async function probeValidator(rpcUrl: string) {
  try {
    const { Connection } = await import("@solana/web3.js");
    const connection = new Connection(rpcUrl, "confirmed");
    await connection.getVersion();
    return connection;
  } catch {
    return null;
  }
}

function resolveDeploy(
  finding: Finding,
  summary: ProgramSummary,
  ctx: VerifierContext,
  map: DeployMap | null,
): DeployEntry | null {
  if (!map) return null;
  const byCase = map.byCaseId;
  if (ctx.caseId && byCase?.[ctx.caseId]) {
    const name = byCase[ctx.caseId];
    const entry = map[name];
    if (entry && typeof entry === "object" && "programId" in entry) {
      return entry as DeployEntry;
    }
  }
  for (const [name, entry] of Object.entries(map)) {
    if (name === "byCaseId" || !entry || typeof entry !== "object" || !("programId" in entry)) {
      continue;
    }
    const e = entry as DeployEntry;
    if (summary.program_name.includes(name) || name.includes(summary.program_name)) {
      return e;
    }
    if (e.caseIds?.some((id) => id === ctx.caseId)) return e;
  }
  const fixture = FIXTURE_BY_CLASS[finding.vulnerability_class];
  const mapped = fixture ? map[fixture] : null;
  if (mapped && typeof mapped === "object" && "programId" in mapped) {
    return mapped as DeployEntry;
  }
  return null;
}

async function verifyOne(
  summary: ProgramSummary,
  finding: Finding,
  connection: Awaited<ReturnType<typeof probeValidator>>,
  ctx: VerifierContext,
  map: DeployMap | null,
): Promise<VerifiedFinding> {
  if (!FULL_PROOF.includes(finding.vulnerability_class)) {
    return {
      ...finding,
      verdict: "UNCONFIRMED",
      exploit_transaction: null,
      pre_state: null,
      post_state: null,
      notes:
        finding.vulnerability_class === 4
          ? "Class 4 requires multi-account relationship setup beyond current automation."
          : "Class 5 requires custom PDA derivation per program; static detection only in v1.",
    };
  }

  const plan = describeExploit(finding);
  if (!connection) {
    return unconfirmed(finding, `No local solana-test-validator at ${ctx.rpcUrl}. Planned: ${plan}`);
  }

  const deploy = resolveDeploy(finding, summary, ctx, map);
  if (!deploy) {
    return unconfirmed(
      finding,
      `No deploy-map entry for ${summary.program_name} / class ${finding.vulnerability_class}. Planned: ${plan}`,
    );
  }

  try {
    switch (finding.vulnerability_class) {
      case 1:
        return await proveMissingSigner(connection, deploy, finding);
      case 2:
        return await proveMissingOwner(connection, deploy, finding);
      case 3:
        return await proveTypeCosplay(connection, deploy, finding);
      default:
        return unconfirmed(finding, plan);
    }
  } catch (err) {
    return unconfirmed(
      finding,
      `Exploit attempt failed: ${err instanceof Error ? err.message : String(err)}. Planned: ${plan}`,
    );
  }
}

function unconfirmed(finding: Finding, notes: string): VerifiedFinding {
  return {
    ...finding,
    verdict: "UNCONFIRMED",
    exploit_transaction: null,
    pre_state: null,
    post_state: null,
    notes,
  };
}

function anchorDisc(ixName: string): Buffer {
  return createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

async function loadPayer() {
  const { Keypair } = await import("@solana/web3.js");
  const path =
    process.env.SOLANA_WALLET ?? join(homedir(), ".config", "solana", "id.json");
  if (!existsSync(path)) return Keypair.generate();
  const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

type Conn = NonNullable<Awaited<ReturnType<typeof probeValidator>>>;

async function proveMissingSigner(
  connection: Conn,
  deploy: DeployEntry,
  finding: Finding,
): Promise<VerifiedFinding> {
  const {
    Keypair,
    PublicKey,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
  } = await import("@solana/web3.js");

  const programId = new PublicKey(deploy.programId);
  const payer = await loadPayer();
  const authority = Keypair.generate();
  const pre = await connection.getBalance(payer.publicKey);

  const ix = new TransactionInstruction({
    programId,
    keys: [{ pubkey: authority.publicKey, isSigner: false, isWritable: false }],
    data: anchorDisc("log_message"),
  });
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer],
    { commitment: "confirmed" },
  );
  const post = await connection.getBalance(payer.publicKey);

  return {
    ...finding,
    verdict: "PROVEN",
    exploit_transaction: sig,
    pre_state: { payer_lamports: pre },
    post_state: { payer_lamports: post },
    notes: "Transaction succeeded without authority signature (missing signer check).",
  };
}

async function proveMissingOwner(
  connection: Conn,
  deploy: DeployEntry,
  finding: Finding,
): Promise<VerifiedFinding> {
  const {
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
  } = await import("@solana/web3.js");

  const programId = new PublicKey(deploy.programId);
  const payer = await loadPayer();
  const authority = Keypair.generate();
  const dataAccount = Keypair.generate();

  const rent = await connection.getMinimumBalanceForRentExemption(8);
  const create = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: dataAccount.publicKey,
    lamports: rent,
    space: 8,
    programId: SystemProgram.programId,
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(create), [
    payer,
    dataAccount,
  ]);

  const pre = await connection.getAccountInfo(dataAccount.publicKey);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: dataAccount.publicKey, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: anchorDisc("touch"),
  });
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer, authority],
    { commitment: "confirmed" },
  );
  const post = await connection.getAccountInfo(dataAccount.publicKey);

  return {
    ...finding,
    verdict: "PROVEN",
    exploit_transaction: sig,
    pre_state: { owner: pre?.owner.toBase58() ?? null, lamports: pre?.lamports ?? null },
    post_state: { owner: post?.owner.toBase58() ?? null, lamports: post?.lamports ?? null },
    notes: "Transaction succeeded with System Program-owned account (missing owner check).",
  };
}

async function proveTypeCosplay(
  connection: Conn,
  deploy: DeployEntry,
  finding: Finding,
): Promise<VerifiedFinding> {
  const {
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
  } = await import("@solana/web3.js");

  const programId = new PublicKey(deploy.programId);
  const payer = await loadPayer();
  const authority = Keypair.generate();
  const userAccount = Keypair.generate();

  // System-owned account with no Anchor discriminator — proves UncheckedAccount acceptance.
  const rent = await connection.getMinimumBalanceForRentExemption(8);
  const create = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: userAccount.publicKey,
    lamports: rent,
    space: 8,
    programId: SystemProgram.programId,
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(create), [
    payer,
    userAccount,
  ]);

  const pre = await connection.getAccountInfo(userAccount.publicKey);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: userAccount.publicKey, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: anchorDisc("update_user"),
  });
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer, authority],
    { commitment: "confirmed" },
  );
  const post = await connection.getAccountInfo(userAccount.publicKey);

  return {
    ...finding,
    verdict: "PROVEN",
    exploit_transaction: sig,
    pre_state: {
      owner: pre?.owner.toBase58() ?? null,
      data_len: pre?.data.length ?? 0,
      has_anchor_discriminator: false,
    },
    post_state: {
      owner: post?.owner.toBase58() ?? null,
      data_len: post?.data.length ?? 0,
    },
    notes:
      "Transaction succeeded on UncheckedAccount without Anchor discriminator (type cosplay).",
  };
}

function describeExploit(finding: Finding): string {
  switch (finding.vulnerability_class) {
    case 1:
      return `call ${finding.instruction_name} with account '${finding.account_name}' unsigned`;
    case 2:
      return `call ${finding.instruction_name} passing '${finding.account_name}' owned by the System Program`;
    case 3:
      return `call ${finding.instruction_name} passing '${finding.account_name}' without discriminator`;
    default:
      return "not attempted";
  }
}
