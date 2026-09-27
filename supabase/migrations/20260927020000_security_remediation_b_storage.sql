-- Preserve public image retrieval from product-images, while preventing anonymous
-- object listing. The product-images bucket remains public at the bucket level.
-- product-photos has no objects or application/database references; lock it down
-- without deleting the bucket or data.
begin;

drop policy if exists "Public can view product images" on storage.objects;
drop policy if exists "Public can read product photos" on storage.objects;
drop policy if exists "Admin can upload product photos" on storage.objects;
drop policy if exists "Admin can delete product photos" on storage.objects;

commit;
