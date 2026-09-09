/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Le streaming SSE de /api/debate/stream ne demande aucune configuration
  // particulière ici : la route renvoie un ReadableStream et fixe elle-même
  // les en-têtes anti-bufferisation (Cache-Control, X-Accel-Buffering).
  //
  // La limite ci-dessous concerne uniquement la taille des corps de requête :
  // une reprise après pause renvoie l'historique complet du débat, qui peut
  // dépasser la valeur par défaut sur un long échange.
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
