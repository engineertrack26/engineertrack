# Untrusted-user probe

Run: 2026-09-20T19:48:22.835Z

## anon (no session) — direct table reads
| table | rows | note |
| profiles | 0 |  |
| profiles_public | 0 |  |
| student_profiles | 0 |  |
| student_codes | 0 |  |
| internship_groups | 0 |  |
| group_memberships | 0 |  |
| group_competency_targets | 0 |  |
| group_assignments | 0 |  |
| assignment_submissions | 0 |  |
| kpi_observations | 0 |  |
| competencies | 0 |  |
| competency_kpis | 0 |  |
| kpi_triplets | 0 |  |
| feed_posts | 0 |  |
| feed_comments | 0 |  |
| feed_likes | 0 |  |
| feed_attachments | 0 |  |
| feed_poll_options | 0 |  |
| feed_poll_votes | 0 |  |
| conversations | 0 |  |
| conversation_participants | 0 |  |
| messages | 0 |  |
| conversation_reads | 0 |  |
| conversation_blocks | 0 |  |
| notifications | 0 |  |
| internship_placements | — | refused: permission denied for table internship_placements |
| internship_days | — | refused: permission denied for table internship_days |
| internship_day_events | — | refused: permission denied for table internship_day_events |
| internship_closures | 0 |  |
| xp_transactions | 0 |  |
| earned_badges | 0 |  |
| daily_logs | 0 |  |
| mentor_feedbacks | 0 |  |
| log_photos | 0 |  |
| log_documents | 0 |  |
| polls | 0 |  |

## anon (no session) — RPCs with ids they do not own
| rpc | outcome |
| list_feed_posts | refused: NOT_AUTHENTICATED |
| internship_group_attendance | refused: permission denied for function internship_group_attendance |
| internship_week | refused: permission denied for function internship_week |
| internship_people | refused: permission denied for function internship_people |
| get_competency_progress | refused: NOT_AUTHENTICATED |
| competency_self_vs_mentor | refused: NOT_AUTHENTICATED |
| get_internship_report | refused: NOT_AUTHENTICATED |
| internship_closure_status | refused: NOT_AUTHENTICATED |
| list_conversations | refused: NOT_AUTHENTICATED |
| list_messages | refused: NOT_AUTHENTICATED |
| open_conversation | refused: NOT_AUTHENTICATED |
| open_case | refused: NOT_AUTHENTICATED |
| list_message_contacts | refused: NOT_AUTHENTICATED |
| group_assignment_counts | succeeded, empty |
| list_feed_pending | refused: NOT_AUTHENTICATED |
| get_my_group_leaderboard | refused: NOT_AUTHENTICATED |
| validate_group_code | refused: NOT_AUTHENTICATED |
| link_student_by_code | refused: NOT_AUTHENTICATED |
| review_assignment | refused: NOT_AUTHENTICATED |
| set_submission_sharing | refused: NOT_AUTHENTICATED |
| close_internship | refused: NOT_AUTHENTICATED |
| publish_assignments | refused: NOT_AUTHENTICATED |
| create_feed_post | refused: NOT_AUTHENTICATED |
| vote_feed_poll | refused: NOT_AUTHENTICATED |
| record_consent | refused: NOT_AUTHENTICATED |
| can_message | refused: Could not find the function public.can_message(p_a, p_b, p_group_id) in the schema cache |
| internship_closed | succeeded, empty |
| internship_notify | refused: permission denied for function internship_notify |
| build_internship_report | refused: ID_FORBIDDEN |
| conversation_other | refused: Could not find the function public.conversation_other(p_conversation_id, p_user_id) in … |

## anon (no session) — storage
| bucket | list | download known path | upload into another user's folder |
| log-photos | 0 entries | refused: {} | refused: new row violates row-level security policy |
| log-documents | 0 entries | n/a | refused: new row violates row-level security policy |
| assignment-docs | refused: Bad Gateway | n/a | refused: new row violates row-level security policy |
| feed-attachments | 0 entries | n/a | refused: new row violates row-level security policy |
| avatars | 1 entries **LISTS** | n/a | refused: new row violates row-level security policy |
| internship-day-files | 0 entries | n/a | refused: mime type text/plain is not supported |

Outsider account: outsider.1789933767074@sim.engineertrack.test (student, no group, no mentor; delete afterwards)
## outsider (signed in, no group) — direct table reads
| table | rows | note |
| profiles | 1 |  |
| profiles_public | 1 |  |
| student_profiles | 0 |  |
| student_codes | 0 |  |
| internship_groups | 0 |  |
| group_memberships | 0 |  |
| group_competency_targets | 0 |  |
| group_assignments | 0 |  |
| assignment_submissions | 0 |  |
| kpi_observations | 0 |  |
| competencies | 5 |  |
| competency_kpis | 5 |  |
| kpi_triplets | 5 |  |
| feed_posts | 0 |  |
| feed_comments | 0 |  |
| feed_likes | 0 |  |
| feed_attachments | 0 |  |
| feed_poll_options | 0 |  |
| feed_poll_votes | 0 |  |
| conversations | 0 |  |
| conversation_participants | 0 |  |
| messages | 0 |  |
| conversation_reads | 0 |  |
| conversation_blocks | 0 |  |
| notifications | 0 |  |
| internship_placements | — | refused: permission denied for table internship_placements |
| internship_days | — | refused: permission denied for table internship_days |
| internship_day_events | — | refused: permission denied for table internship_day_events |
| internship_closures | 0 |  |
| xp_transactions | 0 |  |
| earned_badges | 0 |  |
| daily_logs | 0 |  |
| mentor_feedbacks | 0 |  |
| log_photos | 0 |  |
| log_documents | 0 |  |
| polls | 0 |  |

## outsider (signed in, no group) — RPCs with ids they do not own
| rpc | outcome |
| list_feed_posts | refused: NOT_IN_GROUP |
| internship_group_attendance | refused: ID_FORBIDDEN |
| internship_week | refused: ID_FORBIDDEN |
| internship_people | succeeded, empty |
| get_competency_progress | refused: ROLE_NOT_ALLOWED |
| competency_self_vs_mentor | refused: SELF_ASSESSMENT_FORBIDDEN |
| get_internship_report | refused: REPORT_FORBIDDEN |
| internship_closure_status | refused: REPORT_FORBIDDEN |
| list_conversations | succeeded, empty |
| list_messages | refused: CONVERSATION_NOT_FOUND |
| open_conversation | refused: CANNOT_MESSAGE |
| open_case | refused: CANNOT_OPEN_CASE |
| list_message_contacts | succeeded, empty |
| group_assignment_counts | succeeded, empty |
| list_feed_pending | refused: NOT_GROUP_OWNER |
| get_my_group_leaderboard | succeeded, empty |
| validate_group_code | **SUCCEEDED** [{"id":"861d35d8-5083-4146-a8eb-38b10b5a0640","name":"ÇEV 400 Staj — Güz 2026","term":"… |
| link_student_by_code | refused: ROLE_NOT_ALLOWED |
| review_assignment | refused: ROLE_NOT_ALLOWED |
| set_submission_sharing | refused: NOT_OWNER |
| close_internship | refused: NOT_GROUP_OWNER |
| publish_assignments | refused: ROLE_NOT_ALLOWED |
| create_feed_post | refused: NOT_GROUP_OWNER |
| vote_feed_poll | refused: NOT_IN_GROUP |
| record_consent | succeeded, empty |
| can_message | refused: Could not find the function public.can_message(p_a, p_b, p_group_id) in the schema cache |
| internship_closed | refused: permission denied for function internship_closed |
| internship_notify | refused: permission denied for function internship_notify |
| build_internship_report | refused: permission denied for function build_internship_report |
| conversation_other | refused: Could not find the function public.conversation_other(p_conversation_id, p_user_id) in … |

## outsider (signed in, no group) — storage
| bucket | list | download known path | upload into another user's folder |
| log-photos | 0 entries | refused: {} | refused: new row violates row-level security policy |
| log-documents | 0 entries | n/a | refused: new row violates row-level security policy |
| assignment-docs | 0 entries | n/a | refused: new row violates row-level security policy |
| feed-attachments | 0 entries | n/a | refused: new row violates row-level security policy |
| avatars | 1 entries **LISTS** | n/a | refused: new row violates row-level security policy |
| internship-day-files | 0 entries | n/a | refused: mime type text/plain is not supported |

## Notes
