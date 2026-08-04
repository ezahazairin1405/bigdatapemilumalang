// Semua panggilan ke backend Worker kita sendiri (bukan Gemini -- itu di gemini.js).
const api = {
  async session() {
    const res = await fetch('/api/session');
    return res.json();
  },
  async logout() {
    await fetch('/api/logout', { method: 'POST' });
  },

  async listThemes() {
    const res = await fetch('/api/themes');
    return (await res.json()).themes || [];
  },
  async createTheme(name, kind) {
    const res = await fetch('/api/themes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, kind: kind === 'ai' ? 'ai' : 'data' }),
    });
    return res.json();
  },
  async deleteTheme(id) {
    const res = await fetch(`/api/themes/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async listDocuments(themeId) {
    const qs = themeId ? `?theme_id=${encodeURIComponent(themeId)}` : '';
    const res = await fetch(`/api/documents${qs}`);
    return (await res.json()).documents || [];
  },
  async createDocument(themeId, originalName) {
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme_id: themeId, original_name: originalName }),
    });
    return res.json();
  },
  async updateDocument(id, fields) {
    const res = await fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    });
    return res.json();
  },
  async deleteDocument(id) {
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    return res.json();
  },
  async moveDocument(id, newThemeId) {
    const res = await fetch(`/api/documents/${id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme_id: newThemeId }),
    });
    return res.json();
  },
  async duplicateDocument(id, targetThemeId) {
    const res = await fetch(`/api/documents/${id}/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme_id: targetThemeId }),
    });
    return res.json();
  },

  async listTpsVotes(themeId) {
    const res = await fetch(`/api/tps-votes?theme_id=${encodeURIComponent(themeId)}`);
    return (await res.json()).rows || [];
  },
  async saveTpsVotes(themeId, documentId, source, rows) {
    const res = await fetch('/api/tps-votes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme_id: themeId, document_id: documentId, source, rows }),
    });
    return res.json();
  },

  async kelurahanBoundaries({ kabupaten, kecamatan }) {
    const params = new URLSearchParams();
    if (kabupaten) params.set('kabupaten', kabupaten);
    if (kecamatan) params.set('kecamatan', kecamatan);
    const res = await fetch(`/api/geo/kelurahan?${params.toString()}`);
    return res.json();
  },
};
