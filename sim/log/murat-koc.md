# murat-koc

- `11:55:49` **auth.signUp** {"email":"murat.koc@sim.engineertrack.test","role":"mentor"} → 6fcbba4f-c65a-43ec-a938-60a70808223b
- `11:55:49` **link_student_by_code** {"p_code":"ABC123","p_role":"mentor"} → **ERROR** INVALID_CODE
- _11:55:49_ expected refusal INVALID_CODE for: link with a made-up code
- `11:55:49` **link_student_by_code** {"p_code":"J96G4U","p_role":"mentor"} → [{"student_id":"0588262e-6301-4a16-abb8-82b9a963b2da","student_name":"Zeynep Arslan"}]
- _11:55:49_ link_student_by_code → [{"student_id":"0588262e-6301-4a16-abb8-82b9a963b2da","student_name":"Zeynep Arslan"}] (an ARRAY of one row {student_id, student_name} — RETURNS TABLE)
- `11:55:49` **internship_people** {} → [{"id":"0588262e-6301-4a16-abb8-82b9a963b2da","name":"Zeynep Arslan","company":"Ankara Büyükşehir Belediyesi Çevre Koruma Dairesi","endDate":"2026-09-19","me…
- _11:55:49_ internship_people → 1 student(s); mine is listed.
- `11:55:49` **table.assignment_submissions.select** {} → []
- `11:55:49` **list_mentor_message_contacts** {} → [{"id":"f6f7070c-b697-4bbe-8b3b-0a65d579a132","name":"Selin Aydın","role":"advisor","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Sta…
- _11:55:49_ list_mentor_message_contacts → 2 contact(s), my student included.
- _11:55:49_ Faz 3 bitti.
