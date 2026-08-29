import { join } from "node:path";
import { extractProgram } from "./extractor.js";

const ROOT = join(process.cwd(), "data", "sealevel-attacks", "programs");

function must(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`selftest failed: ${msg}`);
}

export function runSelftest(): void {
  const signerInsecure = extractProgram(
    join(ROOT, "0-signer-authorization", "insecure", "src"),
  );
  const auth = signerInsecure.instructions[0]?.accounts.find((a) => a.name === "authority");
  must(auth && auth.is_signer === false, "insecure signer: authority should not be signer");
  must(
    !signerInsecure.instructions[0].handler_checks.some((c) => c.includes("is_signer")),
    "insecure signer: handler should not check is_signer",
  );

  const signerSecure = extractProgram(
    join(ROOT, "0-signer-authorization", "secure", "src"),
  );
  must(
    signerSecure.instructions[0].handler_checks.some((c) => c.includes("is_signer")),
    "secure signer: handler must record is_signer check",
  );

  const signerRec = extractProgram(
    join(ROOT, "0-signer-authorization", "recommended", "src"),
  );
  const recAuth = signerRec.instructions[0]?.accounts.find((a) => a.name === "authority");
  must(recAuth?.is_signer === true, "recommended signer: Signer<'info> must set is_signer");

  const ownerInsecure = extractProgram(join(ROOT, "2-owner-checks", "insecure", "src"));
  const token = ownerInsecure.instructions[0]?.accounts.find((a) => a.name === "token");
  must(token && !token.owner_constraint, "insecure owner: token has no owner constraint");
  must(
    !ownerInsecure.instructions[0].handler_checks.some((c) =>
      c.includes("program owner"),
    ),
    "insecure owner: no program-owner compare in handler",
  );

  const ownerSecure = extractProgram(join(ROOT, "2-owner-checks", "secure", "src"));
  must(
    ownerSecure.instructions[0].handler_checks.some((c) => c.includes("program owner")),
    "secure owner: handler program-owner check must be extracted",
  );

  const typeInsecure = extractProgram(join(ROOT, "3-type-cosplay", "insecure", "src"));
  const user = typeInsecure.account_types.find((t) => t.name === "User");
  must(user && user.has_anchor_discriminator === false, "type cosplay: User has no Anchor discriminator");
  must(
    !typeInsecure.instructions[0].handler_checks.some((c) => c.includes("discriminant")),
    "insecure type cosplay: no discriminant check",
  );

  const typeSecure = extractProgram(join(ROOT, "3-type-cosplay", "secure", "src"));
  must(
    typeSecure.instructions[0].handler_checks.some((c) => c.includes("discriminant")),
    "secure type cosplay: discriminant check must be extracted",
  );

  const pda = extractProgram(
    join(ROOT, "7-bump-seed-canonicalization", "insecure", "src"),
  );
  must(
    pda.instructions[0].handler_checks.some((c) => c.includes("create_program_address")),
    "insecure bump seed: create_program_address must be extracted",
  );
  must(
    pda.instructions[0].extra_args.some((a) => a.includes("bump")),
    "insecure bump seed: bump extra arg must be parsed",
  );

  process.stdout.write("selftest: extractor assertions passed\n");
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("selftest.ts") || entry?.endsWith("selftest.js")) {
  runSelftest();
}
