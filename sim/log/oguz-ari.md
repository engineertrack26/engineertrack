# oguz-ari

- `11:55:59` **auth.signUp** {"email":"oguz.ari@sim.engineertrack.test","role":"mentor"} → 240d04ee-ce99-49f4-885d-edf6f6ffcec5
- `11:55:59` **link_student_by_code** {"p_code":"ABC123","p_role":"mentor"} → **ERROR** INVALID_CODE
- _11:55:59_ expected refusal INVALID_CODE for: link with a made-up code
- `11:55:59` **link_student_by_code** {"p_code":"T4CZYP","p_role":"mentor"} → [{"student_id":"bd3a9ee1-832a-43d9-8888-bfb26b79f299","student_name":"Deniz Yıldırım"}]
- _11:55:59_ link_student_by_code → [{"student_id":"bd3a9ee1-832a-43d9-8888-bfb26b79f299","student_name":"Deniz Yıldırım"}] (an ARRAY of one row {student_id, student_name} — RETURNS TABLE; adaptation #2)
- `11:55:59` **internship_people** {} → [{"id":"bd3a9ee1-832a-43d9-8888-bfb26b79f299","name":"Deniz Yıldırım","company":"Boğaziçi Geri Dönüşüm Tesisleri","endDate":"2026-09-19","mentorId":"240d04ee…
- _11:55:59_ internship_people → 1 student(s); mine is listed.
- `11:55:59` **table.assignment_submissions.select** {} → []
- `11:55:59` **list_mentor_message_contacts** {} → [{"id":"f6f7070c-b697-4bbe-8b3b-0a65d579a132","name":"Selin Aydın","role":"advisor","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Sta…
- _11:55:59_ list_mentor_message_contacts → 2 contact(s); Deniz is listed.
- _11:55:59_ Faz 3 bitti.
