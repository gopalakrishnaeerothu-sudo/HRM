/**
 * Demo dataset definition.
 *
 * Kept separate from `seed.ts` so the *values* — including office coordinates —
 * live in data rather than being embedded in logic. Nothing in `src/` reads
 * this file; it exists purely to populate a development or demo database.
 *
 * The coordinates below are approximate city-centre points for Guntur and
 * Hyderabad. They are seed values an administrator would replace through the
 * Locations UI, not constants the application depends on.
 */

export interface SeedOffice {
  name: string;
  code: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  timezone: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  workdayStartMinutes: number;
  workdayEndMinutes: number;
  gracePeriodMinutes: number;
}

export const OFFICES: SeedOffice[] = [
  {
    name: "Guntur Headquarters",
    code: "GNT-HQ",
    addressLine: "4th Floor, Brodipet Main Road",
    city: "Guntur",
    state: "Andhra Pradesh",
    postalCode: "522002",
    timezone: "Asia/Kolkata",
    latitude: 16.30656,
    longitude: 80.4365,
    radiusMeters: 100,
    workdayStartMinutes: 9 * 60,
    workdayEndMinutes: 18 * 60,
    gracePeriodMinutes: 15,
  },
  {
    name: "Hyderabad Office",
    code: "HYD-01",
    addressLine: "Tower B, HITEC City, Madhapur",
    city: "Hyderabad",
    state: "Telangana",
    postalCode: "500081",
    timezone: "Asia/Kolkata",
    latitude: 17.44855,
    longitude: 78.39109,
    radiusMeters: 150,
    workdayStartMinutes: 9 * 60 + 30,
    workdayEndMinutes: 18 * 60 + 30,
    gracePeriodMinutes: 20,
  },
];

export interface SeedDepartment {
  name: string;
  code: string;
  color: string;
  description: string;
}

/** Colours map to the validated categorical chart slots, in fixed order. */
export const DEPARTMENTS: SeedDepartment[] = [
  { name: "Engineering", code: "ENG", color: "#2a78d6", description: "Product, platform and infrastructure." },
  { name: "Marketing", code: "MKT", color: "#eb6834", description: "Brand, demand generation and content." },
  { name: "Sales", code: "SLS", color: "#1baf7a", description: "New business and account management." },
  { name: "Human Resources", code: "HR", color: "#eda100", description: "Hiring, people operations and culture." },
  { name: "Finance", code: "FIN", color: "#e87ba4", description: "Accounting, payroll and planning." },
];

export interface SeedTeam {
  name: string;
  slug: string;
  color: string;
  departmentCode: string;
  description: string;
}

export const TEAMS: SeedTeam[] = [
  {
    name: "Frontend Team",
    slug: "frontend",
    color: "#4f46e5",
    departmentCode: "ENG",
    description: "Web application, design system and accessibility.",
  },
  {
    name: "Backend Team",
    slug: "backend",
    color: "#0ea5e9",
    departmentCode: "ENG",
    description: "APIs, data model, integrations and reliability.",
  },
  {
    name: "Marketing Team",
    slug: "marketing",
    color: "#eb6834",
    departmentCode: "MKT",
    description: "Campaigns, website and product marketing.",
  },
  {
    name: "HR Team",
    slug: "people",
    color: "#eda100",
    departmentCode: "HR",
    description: "Recruitment, onboarding and employee experience.",
  },
];

export type SeedRole = "OWNER" | "ADMIN" | "HR" | "MANAGER" | "EMPLOYEE";

export interface SeedEmployee {
  code: string;
  firstName: string;
  lastName: string;
  designation: string;
  departmentCode: string;
  teamSlug?: string;
  officeCode: string;
  role: SeedRole;
  /** `code` of this person's manager. */
  managerCode?: string;
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN" | "CONSULTANT";
  /** Months before today that they joined. */
  joinedMonthsAgo: number;
  status?: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
  /** 0–1: how reliably they turn up, used to generate believable history. */
  attendanceReliability: number;
  /** 0–1: how often they arrive after the grace period. */
  latenessTendency: number;
  bio?: string;
}

/**
 * 22 employees across five departments, with a real reporting hierarchy:
 * owner → department heads → team leads → individual contributors.
 */
export const EMPLOYEES: SeedEmployee[] = [
  {
    code: "ACME-0001",
    firstName: "Aarav",
    lastName: "Mehta",
    designation: "Chief Executive Officer",
    departmentCode: "ENG",
    officeCode: "GNT-HQ",
    role: "OWNER",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 62,
    attendanceReliability: 0.93,
    latenessTendency: 0.08,
    bio: "Founded Acme Technologies in 2021. Spends most of the week in Guntur.",
  },
  {
    code: "ACME-0002",
    firstName: "Kavya",
    lastName: "Reddy",
    designation: "Head of Operations",
    departmentCode: "HR",
    officeCode: "GNT-HQ",
    role: "ADMIN",
    managerCode: "ACME-0001",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 54,
    attendanceReliability: 0.97,
    latenessTendency: 0.04,
    bio: "Runs offices, tooling and internal systems.",
  },
  {
    code: "ACME-0003",
    firstName: "Lakshmi",
    lastName: "Iyer",
    designation: "HR Manager",
    departmentCode: "HR",
    teamSlug: "people",
    officeCode: "GNT-HQ",
    role: "HR",
    managerCode: "ACME-0002",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 41,
    attendanceReliability: 0.96,
    latenessTendency: 0.06,
    bio: "Owns hiring, onboarding and the attendance policy.",
  },
  {
    code: "ACME-0004",
    firstName: "Farhan",
    lastName: "Khan",
    designation: "HR Executive",
    departmentCode: "HR",
    teamSlug: "people",
    officeCode: "GNT-HQ",
    role: "EMPLOYEE",
    managerCode: "ACME-0003",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 14,
    attendanceReliability: 0.92,
    latenessTendency: 0.18,
  },
  {
    code: "ACME-0005",
    firstName: "Rahul",
    lastName: "Verma",
    designation: "Engineering Manager",
    departmentCode: "ENG",
    teamSlug: "backend",
    officeCode: "GNT-HQ",
    role: "MANAGER",
    managerCode: "ACME-0001",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 47,
    attendanceReliability: 0.94,
    latenessTendency: 0.12,
    bio: "Leads the backend group. Cares a great deal about migrations.",
  },
  {
    code: "ACME-0006",
    firstName: "Priya",
    lastName: "Nair",
    designation: "Frontend Lead",
    departmentCode: "ENG",
    teamSlug: "frontend",
    officeCode: "GNT-HQ",
    role: "MANAGER",
    managerCode: "ACME-0005",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 33,
    attendanceReliability: 0.95,
    latenessTendency: 0.1,
    bio: "Design system, accessibility and everything the user actually touches.",
  },
  {
    code: "ACME-0007",
    firstName: "Ananya",
    lastName: "Iyer",
    designation: "Senior Backend Engineer",
    departmentCode: "ENG",
    teamSlug: "backend",
    officeCode: "GNT-HQ",
    role: "EMPLOYEE",
    managerCode: "ACME-0005",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 28,
    attendanceReliability: 0.91,
    latenessTendency: 0.22,
  },
  {
    code: "ACME-0008",
    firstName: "Vikram",
    lastName: "Rao",
    designation: "Backend Engineer",
    departmentCode: "ENG",
    teamSlug: "backend",
    officeCode: "HYD-01",
    role: "EMPLOYEE",
    managerCode: "ACME-0005",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 19,
    attendanceReliability: 0.88,
    latenessTendency: 0.28,
  },
  {
    code: "ACME-0009",
    firstName: "Meera",
    lastName: "Joshi",
    designation: "Platform Engineer",
    departmentCode: "ENG",
    teamSlug: "backend",
    officeCode: "HYD-01",
    role: "EMPLOYEE",
    managerCode: "ACME-0005",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 22,
    attendanceReliability: 0.93,
    latenessTendency: 0.14,
  },
  {
    code: "ACME-0010",
    firstName: "Arjun",
    lastName: "Das",
    designation: "Senior Frontend Engineer",
    departmentCode: "ENG",
    teamSlug: "frontend",
    officeCode: "GNT-HQ",
    role: "EMPLOYEE",
    managerCode: "ACME-0006",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 25,
    attendanceReliability: 0.9,
    latenessTendency: 0.2,
  },
  {
    code: "ACME-0011",
    firstName: "Sneha",
    lastName: "Patel",
    designation: "Frontend Engineer",
    departmentCode: "ENG",
    teamSlug: "frontend",
    officeCode: "GNT-HQ",
    role: "EMPLOYEE",
    managerCode: "ACME-0006",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 11,
    attendanceReliability: 0.94,
    latenessTendency: 0.09,
  },
  {
    code: "ACME-0012",
    firstName: "Karthik",
    lastName: "Menon",
    designation: "Frontend Engineer",
    departmentCode: "ENG",
    teamSlug: "frontend",
    officeCode: "HYD-01",
    role: "EMPLOYEE",
    managerCode: "ACME-0006",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 16,
    attendanceReliability: 0.87,
    latenessTendency: 0.31,
  },
  {
    code: "ACME-0013",
    firstName: "Divya",
    lastName: "Rao",
    designation: "UI Engineer",
    departmentCode: "ENG",
    teamSlug: "frontend",
    officeCode: "GNT-HQ",
    role: "EMPLOYEE",
    managerCode: "ACME-0006",
    employmentType: "CONTRACT",
    joinedMonthsAgo: 6,
    attendanceReliability: 0.89,
    latenessTendency: 0.17,
  },
  {
    code: "ACME-0014",
    firstName: "Rohan",
    lastName: "Gupta",
    designation: "QA Engineer",
    departmentCode: "ENG",
    teamSlug: "backend",
    officeCode: "GNT-HQ",
    role: "EMPLOYEE",
    managerCode: "ACME-0005",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 9,
    attendanceReliability: 0.92,
    latenessTendency: 0.13,
  },
  {
    code: "ACME-0015",
    firstName: "Nikhil",
    lastName: "Shah",
    designation: "Marketing Manager",
    departmentCode: "MKT",
    teamSlug: "marketing",
    officeCode: "GNT-HQ",
    role: "MANAGER",
    managerCode: "ACME-0001",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 30,
    attendanceReliability: 0.9,
    latenessTendency: 0.19,
  },
  {
    code: "ACME-0016",
    firstName: "Tara",
    lastName: "Bose",
    designation: "Content Strategist",
    departmentCode: "MKT",
    teamSlug: "marketing",
    officeCode: "GNT-HQ",
    role: "EMPLOYEE",
    managerCode: "ACME-0015",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 13,
    attendanceReliability: 0.93,
    latenessTendency: 0.11,
  },
  {
    code: "ACME-0017",
    firstName: "Ishaan",
    lastName: "Kulkarni",
    designation: "Performance Marketer",
    departmentCode: "MKT",
    teamSlug: "marketing",
    officeCode: "HYD-01",
    role: "EMPLOYEE",
    managerCode: "ACME-0015",
    employmentType: "PART_TIME",
    joinedMonthsAgo: 7,
    attendanceReliability: 0.85,
    latenessTendency: 0.24,
  },
  {
    code: "ACME-0018",
    firstName: "Sanjay",
    lastName: "Pillai",
    designation: "Sales Manager",
    departmentCode: "SLS",
    officeCode: "HYD-01",
    role: "MANAGER",
    managerCode: "ACME-0001",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 36,
    attendanceReliability: 0.88,
    latenessTendency: 0.26,
  },
  {
    code: "ACME-0019",
    firstName: "Neha",
    lastName: "Agarwal",
    designation: "Account Executive",
    departmentCode: "SLS",
    officeCode: "HYD-01",
    role: "EMPLOYEE",
    managerCode: "ACME-0018",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 15,
    attendanceReliability: 0.86,
    latenessTendency: 0.3,
  },
  {
    code: "ACME-0020",
    firstName: "Aditya",
    lastName: "Sharma",
    designation: "Sales Development Rep",
    departmentCode: "SLS",
    officeCode: "GNT-HQ",
    role: "EMPLOYEE",
    managerCode: "ACME-0018",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 5,
    attendanceReliability: 0.91,
    latenessTendency: 0.16,
  },
  {
    code: "ACME-0021",
    firstName: "Ritu",
    lastName: "Malhotra",
    designation: "Finance Lead",
    departmentCode: "FIN",
    officeCode: "GNT-HQ",
    role: "MANAGER",
    managerCode: "ACME-0002",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 44,
    attendanceReliability: 0.97,
    latenessTendency: 0.03,
  },
  {
    code: "ACME-0022",
    firstName: "Manoj",
    lastName: "Pillai",
    designation: "Accounts Executive",
    departmentCode: "FIN",
    officeCode: "GNT-HQ",
    role: "EMPLOYEE",
    managerCode: "ACME-0021",
    employmentType: "FULL_TIME",
    joinedMonthsAgo: 20,
    status: "ON_LEAVE",
    attendanceReliability: 0.7,
    latenessTendency: 0.1,
  },
];

export interface SeedTask {
  title: string;
  description: string;
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "COMPLETED" | "BLOCKED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assigneeCodes: string[];
  creatorCode: string;
  teamSlug?: string;
  /** Days relative to today. Negative is in the past. */
  dueInDays: number;
  estimatedHours: number;
  progress: number;
  tags: string[];
}

export const TASKS: SeedTask[] = [
  {
    title: "Ship the leave approval flow",
    description:
      "Managers need to approve or decline leave from the dashboard. Include half-day handling and make sure an approved leave marks the attendance record ON_LEAVE.",
    status: "IN_PROGRESS",
    priority: "HIGH",
    assigneeCodes: ["ACME-0010", "ACME-0011"],
    creatorCode: "ACME-0006",
    teamSlug: "frontend",
    dueInDays: 4,
    estimatedHours: 24,
    progress: 55,
    tags: ["frontend", "leave"],
  },
  {
    title: "Payment retry queue keeps stalling",
    description:
      "Retries back off correctly but the queue stops draining after roughly 200 messages. Suspect the visibility timeout.",
    status: "IN_PROGRESS",
    priority: "URGENT",
    assigneeCodes: ["ACME-0007"],
    creatorCode: "ACME-0005",
    teamSlug: "backend",
    dueInDays: 0,
    estimatedHours: 12,
    progress: 60,
    tags: ["backend", "bug"],
  },
  {
    title: "Audit login rate limits",
    description: "Confirm the limiter is applied per user and per IP, and document the thresholds.",
    status: "TODO",
    priority: "MEDIUM",
    assigneeCodes: ["ACME-0008"],
    creatorCode: "ACME-0005",
    teamSlug: "backend",
    dueInDays: 6,
    estimatedHours: 8,
    progress: 0,
    tags: ["security"],
  },
  {
    title: "Geofence radius settings UI",
    description: "Let admins adjust an office perimeter with a live preview and an audit entry.",
    status: "COMPLETED",
    priority: "HIGH",
    assigneeCodes: ["ACME-0012"],
    creatorCode: "ACME-0006",
    teamSlug: "frontend",
    dueInDays: -3,
    estimatedHours: 16,
    progress: 100,
    tags: ["frontend", "geofence"],
  },
  {
    title: "Onboarding email sequence",
    description: "Five emails over the first fortnight. Draft copy, then wire to the transport.",
    status: "IN_REVIEW",
    priority: "MEDIUM",
    assigneeCodes: ["ACME-0016", "ACME-0017"],
    creatorCode: "ACME-0015",
    teamSlug: "marketing",
    dueInDays: 2,
    estimatedHours: 20,
    progress: 80,
    tags: ["marketing", "lifecycle"],
  },
  {
    title: "Q3 attendance compliance report",
    description: "Pull late arrivals and flagged check-ins per department for the quarterly review.",
    status: "TODO",
    priority: "HIGH",
    assigneeCodes: ["ACME-0003"],
    creatorCode: "ACME-0002",
    teamSlug: "people",
    dueInDays: 9,
    estimatedHours: 10,
    progress: 0,
    tags: ["hr", "reporting"],
  },
  {
    title: "Migrate attendance events to partitioned tables",
    description:
      "The events table grows quickly. Partition by month before it becomes a problem to query.",
    status: "BLOCKED",
    priority: "MEDIUM",
    assigneeCodes: ["ACME-0009"],
    creatorCode: "ACME-0005",
    teamSlug: "backend",
    dueInDays: 14,
    estimatedHours: 32,
    progress: 15,
    tags: ["backend", "database"],
  },
  {
    title: "Mobile check-in usability pass",
    description:
      "The check-in button sits under the thumb on small screens, but the status band scrolls out of view. Fix the layout.",
    status: "TODO",
    priority: "HIGH",
    assigneeCodes: ["ACME-0011", "ACME-0013"],
    creatorCode: "ACME-0006",
    teamSlug: "frontend",
    dueInDays: -1,
    estimatedHours: 12,
    progress: 20,
    tags: ["frontend", "mobile"],
  },
  {
    title: "Enterprise pricing page",
    description: "New tier, comparison table, and a contact form that routes to Sales.",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    assigneeCodes: ["ACME-0016"],
    creatorCode: "ACME-0015",
    teamSlug: "marketing",
    dueInDays: 7,
    estimatedHours: 14,
    progress: 40,
    tags: ["marketing", "website"],
  },
  {
    title: "Close Q2 books",
    description: "Reconcile vendor invoices and file the quarterly return.",
    status: "COMPLETED",
    priority: "URGENT",
    assigneeCodes: ["ACME-0022"],
    creatorCode: "ACME-0021",
    dueInDays: -8,
    estimatedHours: 24,
    progress: 100,
    tags: ["finance"],
  },
  {
    title: "Renewal outreach — top 20 accounts",
    description: "Personalised outreach ahead of the renewal window.",
    status: "IN_PROGRESS",
    priority: "HIGH",
    assigneeCodes: ["ACME-0019", "ACME-0020"],
    creatorCode: "ACME-0018",
    dueInDays: 3,
    estimatedHours: 18,
    progress: 45,
    tags: ["sales"],
  },
  {
    title: "Accessibility audit of the task board",
    description:
      "Native drag-and-drop is not keyboard-reachable. Confirm the status select covers that path and check focus order throughout.",
    status: "TODO",
    priority: "HIGH",
    assigneeCodes: ["ACME-0013"],
    creatorCode: "ACME-0006",
    teamSlug: "frontend",
    dueInDays: 5,
    estimatedHours: 10,
    progress: 0,
    tags: ["frontend", "accessibility"],
  },
  {
    title: "Regression suite for attendance rules",
    description: "Cover late, half-day, overtime and weekend paths against the computeDay function.",
    status: "IN_REVIEW",
    priority: "MEDIUM",
    assigneeCodes: ["ACME-0014"],
    creatorCode: "ACME-0005",
    teamSlug: "backend",
    dueInDays: 1,
    estimatedHours: 16,
    progress: 75,
    tags: ["testing", "backend"],
  },
  {
    title: "Hyderabad office perimeter is too tight",
    description:
      "Staff parking on the far side of the building fall outside 100 m. Widen to 150 m and confirm with the site team.",
    status: "COMPLETED",
    priority: "URGENT",
    assigneeCodes: ["ACME-0002"],
    creatorCode: "ACME-0018",
    dueInDays: -5,
    estimatedHours: 2,
    progress: 100,
    tags: ["geofence", "operations"],
  },
  {
    title: "Draft the 2026 hiring plan",
    description: "Head count by department, with budget bands agreed with Finance.",
    status: "TODO",
    priority: "LOW",
    assigneeCodes: ["ACME-0003", "ACME-0021"],
    creatorCode: "ACME-0002",
    dueInDays: 21,
    estimatedHours: 20,
    progress: 0,
    tags: ["hr", "planning"],
  },
  {
    title: "Fix overtime rounding on partial days",
    description: "Overtime is rounding up on half days, inflating the monthly report by a few minutes.",
    status: "TODO",
    priority: "MEDIUM",
    assigneeCodes: ["ACME-0009"],
    creatorCode: "ACME-0014",
    teamSlug: "backend",
    dueInDays: 8,
    estimatedHours: 6,
    progress: 0,
    tags: ["backend", "bug"],
  },
  {
    title: "Onboard three new sales hires",
    description: "Accounts, office assignment, equipment and a first-week schedule.",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    assigneeCodes: ["ACME-0004"],
    creatorCode: "ACME-0003",
    teamSlug: "people",
    dueInDays: 2,
    estimatedHours: 12,
    progress: 65,
    tags: ["hr", "onboarding"],
  },
  {
    title: "Dark mode contrast sweep",
    description: "Several muted labels fall below 4.5:1 on the dark surface. Re-step the tokens.",
    status: "COMPLETED",
    priority: "MEDIUM",
    assigneeCodes: ["ACME-0011"],
    creatorCode: "ACME-0006",
    teamSlug: "frontend",
    dueInDays: -6,
    estimatedHours: 8,
    progress: 100,
    tags: ["frontend", "accessibility"],
  },
];

export const HOLIDAYS = [
  { name: "Independence Day", monthDay: "08-15", isOptional: false },
  { name: "Gandhi Jayanti", monthDay: "10-02", isOptional: false },
  { name: "Diwali", monthDay: "11-08", isOptional: false },
  { name: "Christmas Day", monthDay: "12-25", isOptional: false },
  { name: "Republic Day", monthDay: "01-26", isOptional: false },
];

export const ORGANIZATION = {
  name: "Acme Technologies",
  legalName: "Acme Technologies Private Limited",
  slug: "acme-technologies",
  timezone: "Asia/Kolkata",
  currency: "INR",
  locale: "en-IN",
} as const;
