delete from auth.users
where id in (
  '5097be66-7766-404e-9015-7bc915abd0c3'::uuid,
  '86186053-4175-4f9d-ba32-e4fb10a768a0'::uuid
);

delete from public.guest_identities
where id = 'd2e563da-2861-4843-b979-1c984dcd3140'::uuid;
