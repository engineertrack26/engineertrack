export interface InternshipGroup {
  id: string;
  advisorId: string;
  name: string;
  term?: string;
  joinCode: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What validate_group_code and join_group_by_code return — no join code,
 *  because a student who has not joined yet must not be handed one. */
export interface GroupSummary {
  id: string;
  name: string;
  term?: string;
  advisorName: string;
}

export interface GroupMember {
  membershipId: string;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string;
  joinedAt: string;
}
