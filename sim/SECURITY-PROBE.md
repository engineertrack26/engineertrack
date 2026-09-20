# Untrusted-user probe

Run: 2026-09-20T20:05:47.557Z

## anon (no session) — direct table reads
| table | rows | note |
| profiles | — | refused: permission denied for function is_mentor_of |
| profiles_public | 0 |  |
| student_profiles | — | refused: permission denied for function is_mentor_of |
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
| xp_transactions | — | refused: permission denied for function is_mentor_of |
| earned_badges | — | refused: permission denied for function is_mentor_of |
| daily_logs | — | refused: permission denied for function is_mentor_of |
| mentor_feedbacks | — | refused: permission denied for function is_mentor_of |
| log_photos | — | refused: permission denied for function is_mentor_of |
| log_documents | — | refused: permission denied for function is_mentor_of |
| polls | — | refused: permission denied for function is_mentor_of |

## anon (no session) — RPCs with ids they do not own
| rpc | outcome |
| list_feed_posts | refused: permission denied for function list_feed_posts |
| internship_group_attendance | refused: permission denied for function internship_group_attendance |
| internship_week | refused: permission denied for function internship_week |
| internship_people | refused: permission denied for function internship_people |
| get_competency_progress | refused: permission denied for function get_competency_progress |
| competency_self_vs_mentor | refused: permission denied for function competency_self_vs_mentor |
| get_internship_report | refused: permission denied for function get_internship_report |
| internship_closure_status | refused: permission denied for function internship_closure_status |
| list_conversations | refused: permission denied for function list_conversations |
| list_messages | refused: permission denied for function list_messages |
| open_conversation | refused: permission denied for function open_conversation |
| open_case | refused: permission denied for function open_case |
| list_message_contacts | refused: permission denied for function list_message_contacts |
| group_assignment_counts | refused: permission denied for function group_assignment_counts |
| list_feed_pending | refused: permission denied for function list_feed_pending |
| get_my_group_leaderboard | refused: permission denied for function get_my_group_leaderboard |
| validate_group_code | refused: permission denied for function validate_group_code |
| link_student_by_code | refused: permission denied for function link_student_by_code |
| review_assignment | refused: permission denied for function review_assignment |
| set_submission_sharing | refused: permission denied for function set_submission_sharing |
| close_internship | refused: permission denied for function close_internship |
| publish_assignments | refused: permission denied for function publish_assignments |
| create_feed_post | refused: permission denied for function create_feed_post |
| vote_feed_poll | refused: permission denied for function vote_feed_poll |
| record_consent | refused: permission denied for function record_consent |
| can_message | refused: permission denied for function can_message |
| internship_closed | refused: permission denied for function internship_closed |
| internship_notify | refused: permission denied for function internship_notify |
| build_internship_report | refused: permission denied for function build_internship_report |
| conversation_other | refused: permission denied for function conversation_other |
| is_mentor_of | refused: permission denied for function is_mentor_of |
| owns_group | refused: permission denied for function owns_group |
| shares_group_with | refused: permission denied for function shares_group_with |

## anon (no session) — storage
| bucket | list | download known path | upload into another user's folder |
| log-photos | refused: permission denied for function is_mentor_of | refused: {} | refused: mime type text/plain is not supported |
| log-documents | refused: permission denied for function is_mentor_of | n/a | refused: permission denied for function owns_group |
| assignment-docs | refused: permission denied for function is_mentor_of | n/a | refused: permission denied for function owns_group |
| feed-attachments | refused: permission denied for function is_mentor_of | n/a | refused: permission denied for function owns_group |
| avatars | refused: permission denied for function is_mentor_of | n/a | refused: mime type text/plain is not supported |
| internship-day-files | refused: permission denied for function is_mentor_of | n/a | refused: mime type text/plain is not supported |

Outsider account: outsider.1789934754185@sim.engineertrack.test (student, no group, no mentor; delete afterwards)
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
| can_message | refused: permission denied for function can_message |
| internship_closed | refused: permission denied for function internship_closed |
| internship_notify | refused: permission denied for function internship_notify |
| build_internship_report | refused: permission denied for function build_internship_report |
| conversation_other | refused: permission denied for function conversation_other |
| is_mentor_of | succeeded, empty |
| owns_group | succeeded, empty |
| shares_group_with | succeeded, empty |

## outsider (signed in, no group) — storage
| bucket | list | download known path | upload into another user's folder |
| log-photos | 0 entries | refused: {} | refused: mime type text/plain is not supported |
| log-documents | 0 entries | n/a | refused: new row violates row-level security policy |
| assignment-docs | 0 entries | n/a | refused: new row violates row-level security policy |
| feed-attachments | 0 entries | n/a | refused: new row violates row-level security policy |
| avatars | 0 entries | n/a | refused: mime type text/plain is not supported |
| internship-day-files | 0 entries | n/a | refused: mime type text/plain is not supported |

## Notes
