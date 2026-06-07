export type Role = "advisor" | "guest";

export interface AdvisorStats {
  cases_reviewed: number;
  accuracy_rate: number;
  avg_response_mins: number;
  escalations_filed: number;
  member_since: string;
}

export interface MockAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  title: string;
  license_id: string;
  branch: string;
  stats: AdvisorStats;
}

export const GUEST_ACCOUNT: MockAccount = {
  id: "guest",
  name: "Guest Reviewer",
  email: "guest@filum.app",
  password: "",
  role: "guest",
  title: "Read-only observer",
  license_id: "—",
  branch: "Sandbox environment",
  stats: {
    cases_reviewed: 0,
    accuracy_rate: 0,
    avg_response_mins: 0,
    escalations_filed: 0,
    member_since: "—",
  },
};

export const MOCK_ACCOUNTS: MockAccount[] = [
  {
    id: "u-naomi",
    name: "Naomi Reyes",
    email: "naomi.reyes@filum.app",
    password: "thread123",
    role: "advisor",
    title: "Senior Fraud Analyst",
    license_id: "FA-22841",
    branch: "Downtown Commercial Branch",
    stats: {
      cases_reviewed: 412,
      accuracy_rate: 96.2,
      avg_response_mins: 18,
      escalations_filed: 37,
      member_since: "Mar 2022",
    },
  },
  {
    id: "u-devon",
    name: "Devon Marsh",
    email: "devon.marsh@filum.app",
    password: "thread123",
    role: "advisor",
    title: "Fraud Triage Advisor",
    license_id: "FA-30567",
    branch: "Riverside Retail Branch",
    stats: {
      cases_reviewed: 178,
      accuracy_rate: 93.8,
      avg_response_mins: 24,
      escalations_filed: 14,
      member_since: "Sep 2024",
    },
  },
];

export const DEMO_CREDENTIALS = {
  email: MOCK_ACCOUNTS[0].email,
  password: MOCK_ACCOUNTS[0].password,
};

export function findMockAccount(email: string, password: string): MockAccount | null {
  const normalized = email.trim().toLowerCase();
  const match = MOCK_ACCOUNTS.find((a) => a.email.toLowerCase() === normalized);
  if (!match || match.password !== password) return null;
  return match;
}

export function findMockAccountByEmail(email: string): MockAccount | null {
  const normalized = email.trim().toLowerCase();
  return MOCK_ACCOUNTS.find((a) => a.email.toLowerCase() === normalized) ?? null;
}
