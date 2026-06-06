// API model types — mirror the FastAPI camelCase responses (app/schemas.py).

export type Role = "employee" | "admin";

export interface User {
  email: string;
  name: string;
  team: string;
  role: Role;
}

export interface ModelOption {
  id: string;
  label: string;
  blurb: string;
  modelId: string;
  inPer1k: number;
  outPer1k: number;
  recommended: boolean;
}

export interface DetectedSecret {
  key: string;
  reason: string;
  platformManaged: boolean;
}

export interface Finding {
  level: "ok" | "warn" | "danger";
  text: string;
}

export interface RepoScan {
  url: string;
  owner: string;
  name: string;
  ref: string;
  commit: string;
  runtime: string;
  framework: string;
  dockerfile: boolean;
  entrypoint: string;
  port: number;
  detectedSecrets: DetectedSecret[];
  findings: Finding[];
}

export interface SecretSlot {
  key: string;
  set: boolean;
  platformManaged: boolean;
  reason?: string | null;
  // client-only: the value the user pastes; never sent to the server
  value?: string;
}

export type Status = "review" | "provisioning" | "live" | "failed";

export interface ValidationCheck {
  id: string;
  ok: boolean;
  warn: boolean;
  friendly: string;
  technical: string;
  warnText?: string | null;
}

export interface CostProjection {
  monthly: number;
  perCall: number;
  callsPerDay: number;
}

export interface Artifact {
  file: string;
  lang: "json" | "yaml" | "bash";
  body: string;
  label: string;
  note: string;
}

export interface Submission {
  id: string;
  repoUrl: string;
  repo: RepoScan;
  appName: string;
  slug: string;
  description: string;
  ownerEmail: string;
  team: string;
  modelId: string;
  budget: number;
  secrets: SecretSlot[];
  status: Status;
  submittedAt: string;
  liveUrl?: string | null;
  spendThisMonth: number;
}

export interface SubmissionDetail {
  submission: Submission;
  manifest: Record<string, unknown>;
  artifacts: Artifact[];
  validation: ValidationCheck[];
  cost: CostProjection;
}

export interface ValidationResponse {
  validation: ValidationCheck[];
  cost: CostProjection;
}

// What the create/validate endpoints accept (subset of Submission).
export interface SubmissionInput {
  repoUrl: string;
  repo: RepoScan;
  appName: string;
  description: string;
  ownerEmail: string;
  team: string;
  modelId: string;
  budget: number;
  secrets: Array<Pick<SecretSlot, "key" | "set" | "platformManaged">>;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// ----- GitHub App connect -----
export interface RepoRef {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface GithubStatus {
  connected: boolean;
  account: string | null;
}

// scan accepts exactly one of these
export type ScanArg = { repoUrl: string } | { repoFullName: string };

// tweak state
export type Look = "soft" | "crisp" | "playful";
export type Density = "cozy" | "compact";
export type Contrast = "normal" | "high";

export interface Tweaks {
  look: Look;
  accent: string;
  dark: boolean;
  contrast: Contrast;
  density: Density;
  showSecrets: boolean;
}
