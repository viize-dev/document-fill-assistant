// ส่วนแสดงแหล่งไฟล์ (Gmail / Drive / โฟลเดอร์) ใน side panel: สถานะบัญชี, ค้นหา, แบ่งหน้า, ป้าย "ทำแล้ว"
// ใช้ textContent เท่านั้น เพราะชื่อไฟล์/ผู้ส่ง/หัวเรื่องมาจากภายนอก

import { SOURCES, fetchItem } from './lib/sources/index.js';
import { SOURCE_CONFIG } from './lib/sources/config.js';
import { doneSet, markDone, itemKey } from './lib/sources/history.js';

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => (k === 'class' ? (e.className = v) : k === 'text' ? (e.textContent = v) : (e[k] = v)));
  kids.forEach((c) => c && e.append(c));
  return e;
};

const sizeText = (b) => (!b ? '' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function mount(root, src, { onPick, setStatus }) {
  let items = [];
  let cursor = '';
  let done = new Set();

  const account = el('span', { class: 'muted small' });
  const disconnect = el('button', { class: 'btn btn-sm', text: 'ยกเลิกการเชื่อมต่อ', hidden: true });
  const connect = el('button', { class: 'btn btn-primary', hidden: true });
  const note = el('div', { class: 'muted small', text: src.permissionNote, hidden: true });
  const query = el('input', { type: 'text', placeholder: src.searchPlaceholder });
  const days = el('select', { title: 'ช่วงเวลา' });
  [['0', 'ทั้งหมด'], ['7', '7 วัน'], ['30', '30 วัน'], ['90', '90 วัน']].forEach(([v, l]) => days.append(new Option(l, v)));
  const go = el('button', { class: 'btn', text: 'ค้นหา' });
  const controls = el('div', { class: 'search', hidden: true }, query, days, go);
  const list = el('ul', { class: 'list' });
  const more = el('button', { class: 'btn btn-sm', text: 'โหลดเพิ่ม', hidden: true });
  root.append(el('div', { class: 'acct' }, account, disconnect), note, connect, controls, list, more);

  const fail = (e) => {
    setStatus(e.message, true);
    if (e.code === 'AUTH') refresh();
  };

  async function refresh() {
    const st = await src.status();
    const needsConnect = !st.connected || st.needsPermission;
    account.textContent = st.connected ? `${src.kind === 'folder' ? 'โฟลเดอร์' : 'บัญชี'}: ${st.account}` : '';
    disconnect.hidden = !st.connected;
    connect.hidden = !needsConnect;
    connect.textContent = st.connected ? 'อนุญาตให้อ่านโฟลเดอร์อีกครั้ง' : src.kind === 'folder' ? 'เลือกโฟลเดอร์' : `เชื่อมต่อ ${src.label}`;
    note.hidden = !needsConnect;
    controls.hidden = needsConnect;
    if (needsConnect) {
      items = [];
      cursor = '';
      list.replaceChildren();
      more.hidden = true;
    }
  }

  function render(next, nextCursor) {
    items = next;
    cursor = nextCursor;
    list.replaceChildren();
    if (!items.length) list.append(el('li', { class: 'muted', text: 'ไม่พบไฟล์ PDF' }));
    items.forEach((item) => {
      const name = el('div', { class: 'name', text: item.name });
      if (done.has(itemKey(item))) name.append(el('span', { class: 'done-tag', text: 'ทำแล้ว' }));
      const meta = el('div', { class: 'muted small', text: [item.meta, sizeText(item.size)].filter(Boolean).join(' · ') });
      const li = el('li', {}, name, meta);
      li.onclick = async () => {
        try {
          setStatus(`กำลังโหลด ${item.name}…`);
          const blob = await fetchItem(item);
          await markDone(item);
          done.add(itemKey(item));
          onPick(blob, item.name);
        } catch (e) {
          fail(e);
        }
      };
      list.append(li);
    });
    more.hidden = !cursor;
  }

  async function search(append = false) {
    try {
      setStatus('กำลังโหลดรายการ…');
      done = await doneSet();
      const r = await src.list({ query: query.value, days: Number(days.value), cursor: append ? cursor : '' });
      render(append ? [...items, ...r.items] : r.items, r.nextCursor);
      setStatus('');
    } catch (e) {
      fail(e);
    }
  }

  go.onclick = () => search(false);
  query.onkeydown = (e) => e.key === 'Enter' && search(false);
  more.onclick = () => search(true);
  connect.onclick = async () => {
    try {
      await src.connect();
      await refresh();
      setStatus('');
      search(false);
    } catch (e) {
      if (e.code !== 'CANCELLED') fail(e);
    }
  };
  disconnect.onclick = async () => {
    await src.disconnect().catch(fail);
    refresh();
  };
  return refresh;
}

export function mountSources(ctx) {
  // แหล่งที่ปิดไว้ (ดู lib/sources/config.js) ซ่อนทั้งแท็บและไม่ติดต่อผู้ให้บริการเลย
  document.querySelectorAll('.tab').forEach((t) => {
    const id = t.dataset.tab;
    if (id !== 'upload' && !SOURCE_CONFIG.enabled[id]) {
      t.remove();
      document.getElementById(`pane-${id}`)?.remove();
    }
  });
  const refreshers = [...document.querySelectorAll('.src')].map((root) => mount(root, SOURCES[root.dataset.source], ctx));
  const refreshAll = () => refreshers.forEach((r) => r());
  refreshAll(); // แสดงสถานะบัญชี/ปุ่มเชื่อมต่อตั้งแต่เปิด
  return refreshAll;
}
