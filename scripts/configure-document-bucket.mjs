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

const buckets = [
  {
    name: 'documentos',
    options: {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    },
  },
  {
    name: 'fotos-funcionarios',
    options: {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
  },
];

for (const bucket of buckets) {
  const { error } = await supabase.storage.updateBucket(bucket.name, bucket.options);
  if (error) {
    throw new Error(`Não foi possível configurar o bucket ${bucket.name}: ${error.message}`);
  }
}

console.log('Bucket documentos privado (10 MB; PDF, JPEG, PNG ou WebP).');
console.log('Bucket fotos-funcionarios público (5 MB; JPEG, PNG ou WebP).');
