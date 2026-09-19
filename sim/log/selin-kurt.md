# selin-kurt

- `11:56:06` **auth.signUp** {"email":"selin.kurt@sim.engineertrack.test","role":"mentor"} → 104bbfa1-f672-46ed-9891-2c576c522fb7
- `11:56:06` **link_student_by_code** {"p_code":"ABC123","p_role":"mentor"} → **ERROR** INVALID_CODE
- _11:56:06_ expected refusal INVALID_CODE for: link with a made-up code
- `11:56:06` **link_student_by_code** {"p_code":"D8ACRA","p_role":"mentor"} → [{"student_id":"cc0077d2-b310-4887-80da-ad807becd378","student_name":"Can Doğan"}]
- _11:56:06_ link_student_by_code → [{"student_id":"cc0077d2-b310-4887-80da-ad807becd378","student_name":"Can Doğan"}] (an ARRAY of one row {student_id, student_name} — RETURNS TABLE)
- `11:56:06` **internship_people** {} → [{"id":"cc0077d2-b310-4887-80da-ad807becd378","name":"Can Doğan","company":"DSİ 5. Bölge Su Kalitesi Laboratuvarı","endDate":"2026-09-19","mentorId":"104bbfa…
- _11:56:06_ internship_people → 1 student(s); mine is listed.
- `11:56:06` **table.assignment_submissions.select** {} → []
- `11:56:06` **list_mentor_message_contacts** {} → [{"id":"f6f7070c-b697-4bbe-8b3b-0a65d579a132","name":"Selin Aydın","role":"advisor","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Sta…
- _11:56:06_ list_mentor_message_contacts → [{"id":"f6f7070c-b697-4bbe-8b3b-0a65d579a132","name":"Selin Aydın","role":"advisor","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Staj — Güz 2026"},{"id":"cc0077d2-b310-4887-80da-ad807becd378","name":"Can Doğan","role":"student","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Staj — Güz 2026"}]
- _11:56:06_ Can Doğan is in my message contacts as {"id":"cc0077d2-b310-4887-80da-ad807becd378","name":"Can Doğan","role":"student","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Staj — Güz 2026"}.
- `11:56:06` **open_conversation** {"p_group_id":"861d35d8-5083-4146-a8eb-38b10b5a0640","p_other_id":"cc0077d2-b310-4887-80da-ad807becd378"} → 0d4c29ff-e610-4e2f-a245-41b5a7a1307d
- _11:56:06_ open_conversation → "0d4c29ff-e610-4e2f-a245-41b5a7a1307d"
- `11:56:06` **send_message** {"p_conversation_id":"0d4c29ff-e610-4e2f-a245-41b5a7a1307d","p_body":"Hoş geldin Can, sorularını buradan yazabilirsin."} → 346754ab-f669-4872-9125-02291fe8a8ab
- _11:56:06_ Faz 3 bitti.
