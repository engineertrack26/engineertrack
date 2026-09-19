# emre-aksoy

- `11:55:46` **auth.signUp** {"email":"emre.aksoy@sim.engineertrack.test","role":"mentor"} → ddfdf911-6584-4d3d-a024-c403897c6223
- `11:55:46` **link_student_by_code** {"p_code":"ABC123","p_role":"mentor"} → **ERROR** INVALID_CODE
- _11:55:46_ expected refusal INVALID_CODE for: link with a made-up code
- `11:55:46` **link_student_by_code** {"p_code":"HHRVB8","p_role":"mentor"} → [{"student_id":"ca663073-8043-41c8-80ee-97e3e4f19c78","student_name":"Ayşe Çelik"}]
- _11:55:46_ link_student_by_code → [{"student_id":"ca663073-8043-41c8-80ee-97e3e4f19c78","student_name":"Ayşe Çelik"}] (an ARRAY of one row {student_id, student_name} — RETURNS TABLE; adaptation #2)
- `11:55:46` **list_mentor_message_contacts** {} → [{"id":"f6f7070c-b697-4bbe-8b3b-0a65d579a132","name":"Selin Aydın","role":"advisor","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Sta…
- _11:55:46_ list_mentor_message_contacts → 2 contact(s); my student is listed.
- _11:55:46_ Faz 3 bitti.
