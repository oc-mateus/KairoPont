import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente antes de continuar.');
}

if (!/^https:\/\//i.test(url)) {
  throw new Error('SUPABASE_URL precisa ser um endereço HTTPS.');
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { error } = await supabase.storage.updateBucket('documentos', {
  public: false,
  fileSizeLimit: 10 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
});

if (error) {
  throw new Error(`Não foi possível configurar o bucket documentos: ${error.message}`);
}

console.log('Bucket documentos configurado como privado, com limite de 10 MB e tipos permitidos.');
