# hakan-demir

- `11:53:35` **auth.signUp** {"email":"hakan.demir@sim.engineertrack.test","role":"mentor"} → 69b34767-16ec-4483-a869-badcd064dc2d
- `11:53:35` **link_student_by_code** {"p_code":"ABC123","p_role":"mentor"} → **ERROR** INVALID_CODE
- _11:53:35_ expected refusal INVALID_CODE for: link with a made-up code
- `11:53:35` **link_student_by_code** {"p_code":"8N2TXF","p_role":"mentor"} → [{"student_id":"5d9c97c7-b804-4a65-890d-7eb65270f2ca","student_name":"Elif Kaya"}]
- _11:53:35_ link_student_by_code → [{"student_id":"5d9c97c7-b804-4a65-890d-7eb65270f2ca","student_name":"Elif Kaya"}] (an ARRAY of one row {student_id, student_name} — RETURNS TABLE; adaptation #2)
- `11:53:35` **internship_people** {} → [{"id":"5d9c97c7-b804-4a65-890d-7eb65270f2ca","name":"Elif Kaya","company":"Marmara Su ve Kanalizasyon İdaresi","endDate":"2026-09-19","mentorId":"69b34767-1…
- _11:53:35_ internship_people → 1 student(s); mine is listed.
- `11:53:36` **table.assignment_submissions.select** {} → []
- `11:53:36` **list_mentor_message_contacts** {} → [{"id":"f6f7070c-b697-4bbe-8b3b-0a65d579a132","name":"Selin Aydın","role":"advisor","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Sta…
- _11:53:36_ Faz 3 bitti.
