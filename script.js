(function(){
  const COLORS = ['#e17076','#faa774','#a695e7','#7bc862','#6ec9cb','#65aadd','#ee7aae','#f2749a'];
  const STORAGE_KEY = 'telegram-todo-data-v2';
  const OLD_STORAGE_KEY = 'telegram-todo-data-v1';

  let state = {
    profiles: [],
    activeProfileId: null
  };

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  // ---------- MOTION HELPERS ----------
  // The app fully rebuilds the sidebar/message DOM on every render(), so a
  // CSS animation tied unconditionally to a class like `.checked` or
  // `.list-pin-icon` would replay on every unrelated re-render (flashy).
  // These "pending" ids let a mutating action mark exactly the element that
  // should animate on the very next render; render consumes and clears them.
  let pendingTaskEnterId = null;   // task just created -> entrance animation
  let pendingListEnterId = null;   // list just created -> entrance animation
  let pendingCheckToggleId = null; // task just (un)checked -> checkbox pop
  let pendingPinToggleListId = null; // list just (un)pinned -> pin icon pop

  const EXIT_ANIM_MS = 220; // keep in sync with --dur-normal in style.css

  // Plays the CSS exit animation on the given elements (if present), then
  // performs the actual state mutation + re-render. Falls back to an
  // immediate commit if the elements aren't in the DOM.
  function animateRemoval(elements, commit){
    const els = elements.filter(Boolean);
    if(!els.length){ commit(); return; }
    let remaining = els.length;
    const finish = () => { remaining--; if(remaining <= 0) commit(); };
    els.forEach(el=>{
      el.classList.add('removing');
      let called = false;
      const onEnd = ()=>{
        if(called) return;
        called = true;
        el.removeEventListener('animationend', onEnd);
        finish();
      };
      el.addEventListener('animationend', onEnd);
      setTimeout(onEnd, EXIT_ANIM_MS + 80); // safety fallback
    });
  }

  // ---------- CONFIRM DIALOG ----------
  const confirmBackdrop = document.getElementById('confirmBackdrop');
  const confirmMessageEl = document.getElementById('confirmMessage');
  const confirmOkBtn = document.getElementById('confirmOkBtn');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');
  let confirmResolve = null;

  function confirmDialog(message){
    confirmMessageEl.textContent = message;
    confirmBackdrop.classList.add('show');
    return new Promise(resolve=>{ confirmResolve = resolve; });
  }
  function resolveConfirm(result){
    confirmBackdrop.classList.remove('show');
    if(confirmResolve){ confirmResolve(result); confirmResolve = null; }
  }
  confirmOkBtn.addEventListener('click', ()=>resolveConfirm(true));
  confirmCancelBtn.addEventListener('click', ()=>resolveConfirm(false));
  confirmBackdrop.addEventListener('click', (e)=>{ if(e.target === confirmBackdrop) resolveConfirm(false); });

  // ---------- EDIT DIALOG ----------
  const editBackdrop = document.getElementById('editBackdrop');
  const editTaskInput = document.getElementById('editTaskInput');
  const editSaveBtn = document.getElementById('editSaveBtn');
  const editCancelBtn = document.getElementById('editCancelBtn');
  let editResolve = null;

  function editDialog(initialText){
    editTaskInput.value = initialText;
    editBackdrop.classList.add('show');
    setTimeout(()=>{ editTaskInput.focus(); editTaskInput.select(); }, 50);
    return new Promise(resolve=>{ editResolve = resolve; });
  }
  function resolveEdit(result){
    editBackdrop.classList.remove('show');
    if(editResolve){ editResolve(result); editResolve = null; }
  }
  editSaveBtn.addEventListener('click', ()=>resolveEdit(editTaskInput.value));
  editCancelBtn.addEventListener('click', ()=>resolveEdit(null));
  editBackdrop.addEventListener('click', (e)=>{ if(e.target === editBackdrop) resolveEdit(null); });
  editTaskInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); resolveEdit(editTaskInput.value); }
    if(e.key === 'Escape'){ resolveEdit(null); }
  });

  function activeProfile(){
    return state.profiles.find(p=>p.id===state.activeProfileId) || state.profiles[0];
  }

  function seedLists(){
    const now = Date.now();
    return [
      {
        id: uid(), name: 'Work', color: COLORS[4], pinned:false, order:0,
        tasks: [
          {id:uid(), text:'Finish quarterly report', done:false, ts: now-3600000, order: now-3600000, pinned:true},
          {id:uid(), text:'Reply to client email', done:true, ts: now-7200000, order: now-7200000, pinned:false},
          {id:uid(), text:'Prep slides for Monday sync', done:false, ts: now-1800000, order: now-1800000, pinned:false},
        ]
      },
      {
        id: uid(), name: 'Personal', color: COLORS[2], pinned:false, order:1,
        tasks: [
          {id:uid(), text:'Book dentist appointment', done:false, ts: now-5400000, order: now-5400000, pinned:false},
          {id:uid(), text:'Call mom', done:false, ts: now-9000000, order: now-9000000, pinned:false},
        ]
      },
      {
        id: uid(), name: 'Shopping', color: COLORS[3], pinned:false, order:2,
        tasks: [
          {id:uid(), text:'Milk, eggs, bread', done:false, ts: now-2400000, order: now-2400000, pinned:false},
          {id:uid(), text:'New running shoes', done:true, ts: now-86400000, order: now-86400000, pinned:false},
        ]
      }
    ];
  }

  function seedData(){
    const profileId = uid();
    return {
      profiles: [
        { id: profileId, name: 'Personal', color: COLORS[5], lists: seedLists(), activeListId: null }
      ],
      activeProfileId: profileId
    };
  }

  function normalizeState(parsed){
    parsed.profiles.forEach(p=>{
      if(!Array.isArray(p.lists)) p.lists = [];
      if(typeof p.activeListId === 'undefined') p.activeListId = null;
      p.lists.forEach((l,i)=>{
        if(typeof l.pinned !== 'boolean') l.pinned = false;
        if(typeof l.order !== 'number') l.order = i;
        l.tasks.forEach(t=>{
          if(typeof t.pinned !== 'boolean') t.pinned = false;
          if(typeof t.order !== 'number') t.order = t.ts;
        });
      });
    });
    if(!parsed.profiles.some(p=>p.id===parsed.activeProfileId)){
      parsed.activeProfileId = parsed.profiles.length ? parsed.profiles[0].id : null;
    }
    return parsed;
  }

  async function loadState(){
    try{
      if(window.storage){
        const res = await window.storage.get(STORAGE_KEY, false);
        if(res && res.value){
          const parsed = JSON.parse(res.value);
          if(parsed && Array.isArray(parsed.profiles) && parsed.profiles.length){
            return normalizeState(parsed);
          }
        }
        const legacy = await window.storage.get(OLD_STORAGE_KEY, false).catch(()=>null);
        if(legacy && legacy.value){
          const old = JSON.parse(legacy.value);
          if(old && Array.isArray(old.lists)){
            const profileId = uid();
            const migrated = {
              profiles: [{ id: profileId, name: 'Personal', color: COLORS[5], lists: old.lists, activeListId: old.activeId || null }],
              activeProfileId: profileId
            };
            return normalizeState(migrated);
          }
        }
      }
    }catch(e){
      console.error('Cloud storage read failed, falling back to local copy', e);
    }
    try{
      const local = localStorage.getItem(STORAGE_KEY);
      if(local){
        const parsed = JSON.parse(local);
        if(parsed && Array.isArray(parsed.profiles) && parsed.profiles.length){
          return normalizeState(parsed);
        }
      }
    }catch(e){}
    return seedData();
  }

  async function saveState(attempt){
    attempt = attempt || 0;
    const json = JSON.stringify(state);

    let localOk = true;
    try{ localStorage.setItem(STORAGE_KEY, json); }
    catch(e){ localOk = false; console.error('Local storage backup failed', e); }

    try{
      if(window.storage){
        await window.storage.set(STORAGE_KEY, json, false);
      }
      setSyncStatus('ok');
    }catch(e){
      console.error('Cloud storage save failed', e);
      if(attempt < 5){
        setSyncStatus('retrying');
        const delay = Math.min(600 * Math.pow(1.7, attempt), 8000);
        setTimeout(()=>saveState(attempt + 1), delay);
      } else if(localOk){
        setSyncStatus('local');
      } else {
        setSyncStatus('error');
      }
    }
  }

  let syncStatusTimer = null;
  function setSyncStatus(status){
    const el = document.getElementById('syncStatus');
    if(!el) return;
    clearTimeout(syncStatusTimer);
    if(status === 'ok'){
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';
    if(status === 'retrying'){
      el.title = 'Saving your changes…';
      el.className = 'sync-dot retrying';
    } else if(status === 'local'){
      el.title = 'Cloud sync is unavailable right now — your changes are saved locally on this device.';
      el.className = 'sync-dot local';
    } else if(status === 'error'){
      el.title = 'Could not save changes.';
      el.className = 'sync-dot error';
    }
  }

  document.getElementById('syncStatus').addEventListener('click', ()=>{
    const el = document.getElementById('syncStatus');
    if(el.classList.contains('local') || el.classList.contains('error')){
      saveState();
    }
  });

  function initials(name){
    return name.trim().split(/\s+/).slice(0,2).map(w=>w[0].toUpperCase()).join('');
  }

  function pendingCount(list){
    return list.tasks.filter(t=>!t.done).length;
  }

  function fmtTime(ts){
    const d = new Date(ts);
    return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  }

  function fmtChatTime(ts){
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if(sameDay) return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    return d.toLocaleDateString([], {day:'2-digit', month:'2-digit', year:'numeric'});
  }

  function lastTask(list){
    if(!list.tasks.length) return null;
    return list.tasks.reduce((a,b)=> a.ts > b.ts ? a : b);
  }

  const PIN_ICON_PATH = 'M12 17v5M5 17h14l-1.4-1.4a2 2 0 0 1-.6-1.4V9a5 5 0 0 0-10 0v5.2a2 2 0 0 1-.6 1.4z';

  function renderSidebar(){
    const scroll = document.getElementById('listScroll');
    scroll.innerHTML = '';
    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    const profile = activeProfile();
    const isFiltering = !!query;

    const lists = [...profile.lists]
      .sort((a,b)=> {
        const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
        if(pa !== pb) return pb - pa;
        return (a.order ?? 0) - (b.order ?? 0);
      })
      .filter(l => {
        if(!query) return true;
        if(l.name.toLowerCase().includes(query)) return true;
        return l.tasks.some(t=>t.text.toLowerCase().includes(query));
      });

    lists.forEach(list=>{
      const row = document.createElement('div');
      row.className = 'chat-row' + (list.id === profile.activeListId ? ' active' : '');
      row.dataset.listId = list.id;
      row.onclick = () => { profile.activeListId = list.id; render(); };
      row.addEventListener('contextmenu', (e)=>{
        e.preventDefault();
        openListContextMenu(e.clientX, e.clientY, list.id);
      });

      const last = lastTask(list);
      const pending = pendingCount(list);
      const pinIconClass = 'list-pin-icon' + (list.id === pendingPinToggleListId ? ' pin-pop' : '');
      const pinIconHtml = list.pinned
        ? `<svg class="${pinIconClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${PIN_ICON_PATH}"/></svg>`
        : '';

      if(list.id === pendingListEnterId) row.classList.add('entering');

      row.innerHTML = `
        <div class="avatar" style="background:${list.color}">${initials(list.name)}</div>
        <div class="chat-meta">
          <div class="chat-top-line">
            <div class="chat-name">${escapeHtml(list.name)}</div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              ${pinIconHtml}
              <div class="chat-time">${last ? fmtChatTime(last.ts) : ''}</div>
            </div>
          </div>
          <div class="chat-bottom-line">
            <div class="chat-preview">${last ? (last.done ? '✓ ' : '') + escapeHtml(last.text) : 'No tasks yet'}</div>
            ${pending > 0 ? `<div class="unread-badge">${pending}</div>` : (list.tasks.length ? `<div class="unread-badge done"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>` : '')}
          </div>
        </div>
      `;
      scroll.appendChild(row);
    });

    pendingListEnterId = null;
    pendingPinToggleListId = null;

    if(!isFiltering) enableListDragReorder(scroll);
  }

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderMain(){
    const empty = document.getElementById('emptyState');
    const chatArea = document.getElementById('chatArea');
    const profile = activeProfile();
    const list = profile.lists.find(l=>l.id === profile.activeListId);

    if(!list){
      empty.style.display = 'flex';
      chatArea.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    chatArea.style.display = 'flex';

    if(selectionListId !== list.id){
      selectionMode = false;
      selectedTaskIds = new Set();
      selectionListId = list.id;
    }

    document.getElementById('headerAvatar').style.background = list.color;
    document.getElementById('headerAvatar').textContent = initials(list.name);
    document.getElementById('headerName').textContent = list.name;
    const pending = pendingCount(list);
    document.getElementById('headerStatus').textContent =
      list.tasks.length === 0 ? 'No tasks' : `${pending} pending, ${list.tasks.length - pending} done`;

    const msgs = document.getElementById('messages');
    msgs.innerHTML = '';
    msgs.classList.toggle('selecting', selectionMode);

    if(list.tasks.length === 0){
      const empty2 = document.createElement('div');
      empty2.style.cssText = 'margin:auto;color:var(--text-muted);font-size:14.5px;';
      empty2.textContent = 'Add your first task below';
      msgs.appendChild(empty2);
    } else {
      const sorted = [...list.tasks].sort((a,b)=> (a.order ?? a.ts) - (b.order ?? b.ts));
      let lastDateLabel = '';
      sorted.forEach(task=>{
        const dateLabel = new Date(task.ts).toDateString();
        if(dateLabel !== lastDateLabel){
          lastDateLabel = dateLabel;
          const chip = document.createElement('div');
          chip.className = 'date-chip';
          const today = new Date().toDateString();
          const yest = new Date(Date.now()-86400000).toDateString();
          chip.textContent = dateLabel === today ? 'Today' : (dateLabel === yest ? 'Yesterday' : new Date(task.ts).toLocaleDateString([], {day:'numeric', month:'long'}));
          msgs.appendChild(chip);
        }

        const row = document.createElement('div');
        row.className = 'msg-row' + (task.done ? ' mine' : '');
        if(task.id === pendingTaskEnterId) row.className += ' entering';
        row.dataset.taskId = task.id;
        const isSelected = selectionMode && selectedTaskIds.has(task.id);
        const checkedClass = selectionMode ? (isSelected ? 'checked' : '') : (task.done ? 'checked' : '');
        const checkPopClass = task.id === pendingCheckToggleId ? ' check-pop' : '';
        row.innerHTML = `
          <div class="bubble ${isSelected ? 'selected' : ''}">
            <div class="check ${checkedClass}${checkPopClass}" data-id="${task.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="msg-body">
              <div class="msg-text ${task.done?'done':''}">${escapeHtml(task.text)}</div>
              <div class="msg-time">${fmtTime(task.ts)}${task.done ? ' <span class="tick">✓✓</span>' : ''}</div>
            </div>
          </div>
        `;
        msgs.appendChild(row);
      });
    }
    pendingTaskEnterId = null;
    pendingCheckToggleId = null;
    msgs.scrollTop = msgs.scrollHeight;

    msgs.querySelectorAll('.check').forEach(el=>{
      el.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(selectionMode){
          toggleSelect(el.dataset.id);
        } else {
          toggleTask(list.id, el.dataset.id);
        }
      });
    });
    msgs.querySelectorAll('.msg-row').forEach(rowEl=>{
      const taskId = rowEl.dataset.taskId;
      rowEl.querySelector('.bubble').addEventListener('click', ()=>{
        if(selectionMode) toggleSelect(taskId);
      });
      rowEl.querySelector('.bubble').addEventListener('contextmenu', (e)=>{
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, list.id, taskId);
      });
    });

    enableDragReorder(msgs, list);
    renderPinnedBar(list);
    renderSelectionBar(list);
  }

  const LONG_PRESS_MS = 380;
  const MOVE_CANCEL_PX = 8;

  function enableDragReorder(container, list){
    container.querySelectorAll('.msg-row').forEach(rowEl=>{
      const bubble = rowEl.querySelector('.bubble');
      let pressTimer = null;
      let startX = 0, startY = 0;
      let dragging = false;

      const cancelPress = ()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer = null; } };

      bubble.addEventListener('pointerdown', (e)=>{
        if(selectionMode) return;
        if(e.button !== undefined && e.button !== 0) return;
        if(e.target.closest('.check, .act-btn')) return;
        startX = e.clientX; startY = e.clientY;
        dragging = false;
        pressTimer = setTimeout(()=>{
          dragging = true;
          beginDrag(rowEl, container, list);
        }, LONG_PRESS_MS);
      });

      bubble.addEventListener('pointermove', (e)=>{
        if(pressTimer && !dragging){
          if(Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX){
            cancelPress();
          }
        }
      });

      ['pointerup','pointercancel','pointerleave'].forEach(evt=>{
        bubble.addEventListener(evt, ()=>{ if(!dragging) cancelPress(); });
      });
    });
  }

  function beginDrag(rowEl, container, list){
    rowEl.classList.add('reordering');
    if(navigator.vibrate) navigator.vibrate(12);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (e)=>{
      e.preventDefault();
      const y = e.clientY;
      const afterElement = getDragAfterElement(container, y);
      if(afterElement == null){
        container.appendChild(rowEl);
      } else if(afterElement !== rowEl){
        container.insertBefore(rowEl, afterElement);
      }
      autoScrollContainer(container, y);
    };

    const onUp = ()=>{
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      rowEl.classList.remove('reordering');
      document.body.style.userSelect = prevUserSelect;
      commitOrder(container, list);
    };

    document.addEventListener('pointermove', onMove, {passive:false});
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function getDragAfterElement(container, y){
    const els = [...container.querySelectorAll('.msg-row:not(.reordering)')];
    return els.reduce((closest, child)=>{
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if(offset < 0 && offset > closest.offset){
        return {offset, element: child};
      }
      return closest;
    }, {offset:-Infinity, element:null}).element;
  }

  function autoScrollContainer(container, y){
    const rect = container.getBoundingClientRect();
    const margin = 44;
    if(y < rect.top + margin) container.scrollTop -= 14;
    else if(y > rect.bottom - margin) container.scrollTop += 14;
  }

  function commitOrder(container, list){
    const rows = [...container.querySelectorAll('.msg-row')];
    rows.forEach((rowEl, i)=>{
      const task = list.tasks.find(t=>t.id===rowEl.dataset.taskId);
      if(task) task.order = i;
    });
    saveState();
    render();
  }

  function enableListDragReorder(container){
    container.querySelectorAll('.chat-row').forEach(rowEl=>{
      let pressTimer = null;
      let startX = 0, startY = 0;
      let dragging = false;

      const cancelPress = ()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer = null; } };

      rowEl.addEventListener('pointerdown', (e)=>{
        if(e.button !== undefined && e.button !== 0) return;
        startX = e.clientX; startY = e.clientY;
        dragging = false;
        pressTimer = setTimeout(()=>{
          dragging = true;
          beginListDrag(rowEl, container);
        }, LONG_PRESS_MS);
      });

      rowEl.addEventListener('pointermove', (e)=>{
        if(pressTimer && !dragging){
          if(Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX){
            cancelPress();
          }
        }
      });

      ['pointerup','pointercancel','pointerleave'].forEach(evt=>{
        rowEl.addEventListener(evt, ()=>{ if(!dragging) cancelPress(); });
      });
    });
  }

  function beginListDrag(rowEl, container){
    rowEl.classList.add('reordering');
    container.classList.add('dragging-list');
    if(navigator.vibrate) navigator.vibrate(12);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    document.addEventListener('click', (e)=>{ e.stopPropagation(); e.preventDefault(); }, {capture:true, once:true});

    const onMove = (e)=>{
      e.preventDefault();
      const y = e.clientY;
      const afterElement = getListDragAfterElement(container, y);
      if(afterElement == null){
        container.appendChild(rowEl);
      } else if(afterElement !== rowEl){
        container.insertBefore(rowEl, afterElement);
      }
      autoScrollContainer(container, y);
    };

    const onUp = ()=>{
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      rowEl.classList.remove('reordering');
      container.classList.remove('dragging-list');
      document.body.style.userSelect = prevUserSelect;
      commitListOrder(container);
    };

    document.addEventListener('pointermove', onMove, {passive:false});
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function getListDragAfterElement(container, y){
    const els = [...container.querySelectorAll('.chat-row:not(.reordering)')];
    return els.reduce((closest, child)=>{
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if(offset < 0 && offset > closest.offset){
        return {offset, element: child};
      }
      return closest;
    }, {offset:-Infinity, element:null}).element;
  }

  function commitListOrder(container){
    const profile = activeProfile();
    const rows = [...container.querySelectorAll('.chat-row')];
    rows.forEach((rowEl, i)=>{
      const list = profile.lists.find(l=>l.id===rowEl.dataset.listId);
      if(list) list.order = i;
    });
    saveState();
    render();
  }

  function openListContextMenu(x, y, listId){
    const profile = activeProfile();
    const list = profile.lists.find(l=>l.id===listId);
    if(!list) return;

    const items = [
      {label:'Rename', icon:'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z', action:()=>{ profile.activeListId = list.id; render(); openRenameModal(); }},
      {label: list.pinned ? 'Unpin' : 'Pin', icon: PIN_ICON_PATH, accent: !list.pinned, action:()=>toggleListPin(list.id)},
      {divider:true},
      {label:'Delete', icon:'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', danger:true, action: async ()=>{
        if(!await confirmDialog(`Delete "${list.name}" and all its tasks?`)) return;
        const el = document.querySelector(`.chat-row[data-list-id="${list.id}"]`);
        animateRemoval([el], ()=>{
          profile.lists = profile.lists.filter(l=>l.id!==list.id);
          if(profile.activeListId === list.id) profile.activeListId = null;
          saveState();
          render();
        });
      }},
    ];

    contextMenuEl.innerHTML = items.map(item=>{
      if(item.divider) return '<div class="context-menu-divider"></div>';
      const cls = ['context-menu-item', item.danger ? 'danger':'', item.accent ? 'accent':''].join(' ').trim();
      return `<div class="${cls}" data-action>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${item.icon}"/></svg>
        <span>${item.label}</span>
      </div>`;
    }).join('');

    const actionable = items.filter(i=>!i.divider);
    contextMenuEl.querySelectorAll('[data-action]').forEach((el,i)=>{
      el.addEventListener('click', ()=>{
        actionable[i].action();
        closeContextMenu();
      });
    });

    contextMenuEl.classList.add('show');
    const rect = contextMenuEl.getBoundingClientRect();
    let left = x, top = y;
    if(left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if(top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    contextMenuEl.style.left = left + 'px';
    contextMenuEl.style.top = top + 'px';
  }

  let selectionMode = false;
  let selectedTaskIds = new Set();
  let selectionListId = null;

  function toggleSelect(taskId){
    if(selectedTaskIds.has(taskId)) selectedTaskIds.delete(taskId);
    else selectedTaskIds.add(taskId);
    if(selectedTaskIds.size === 0) selectionMode = false;
    render();
  }

  function enterSelectionMode(taskId){
    selectionMode = true;
    selectedTaskIds = new Set([taskId]);
    render();
  }

  function exitSelectionMode(){
    selectionMode = false;
    selectedTaskIds = new Set();
    render();
  }

  function renderSelectionBar(list){
    const bar = document.getElementById('selectionBar');
    if(!selectionMode){
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    document.getElementById('selectionCount').textContent = `${selectedTaskIds.size} selected`;

    document.getElementById('selectionCancelBtn').onclick = exitSelectionMode;
    document.getElementById('selectionDoneBtn').onclick = () => {
      list.tasks.forEach(t=>{ if(selectedTaskIds.has(t.id)) t.done = true; });
      saveState();
      exitSelectionMode();
    };
    document.getElementById('selectionDeleteBtn').onclick = async () => {
      if(!await confirmDialog(`Delete ${selectedTaskIds.size} task(s)?`)) return;
      const els = [...document.querySelectorAll('.msg-row')].filter(el=>selectedTaskIds.has(el.dataset.taskId));
      animateRemoval(els, ()=>{
        list.tasks = list.tasks.filter(t=>!selectedTaskIds.has(t.id));
        saveState();
        exitSelectionMode();
      });
    };
  }

  const contextMenuEl = document.getElementById('contextMenu');

  function closeContextMenu(){
    contextMenuEl.classList.remove('show');
  }

  function openContextMenu(x, y, listId, taskId){
    const list = activeProfile().lists.find(l=>l.id===listId);
    const task = list.tasks.find(t=>t.id===taskId);
    if(!task) return;

    const items = [
      {label:'Edit', icon:'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z', action:()=>editTask(listId, taskId)},
      {label: task.pinned ? 'Unpin' : 'Pin', icon:'M12 17v5M5 17h14l-1.4-1.4a2 2 0 0 1-.6-1.4V9a5 5 0 0 0-10 0v5.2a2 2 0 0 1-.6 1.4z', accent: !task.pinned, action:()=>togglePin(listId, taskId)},
      {label:'Copy Text', icon:'M9 9h10v10H9zM5 5h10v2H7v8H5z', action:()=>copyTaskText(task.text)},
      {label:'Select', icon:'M20 6L9 17l-5-5', action:()=>enterSelectionMode(taskId)},
      {divider:true},
      {label:'Delete', icon:'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', danger:true, action:()=>deleteTask(listId, taskId)},
    ];

    contextMenuEl.innerHTML = items.map(item=>{
      if(item.divider) return '<div class="context-menu-divider"></div>';
      const cls = ['context-menu-item', item.danger ? 'danger':'', item.accent ? 'accent':''].join(' ').trim();
      return `<div class="${cls}" data-action>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${item.icon}"/></svg>
        <span>${item.label}</span>
      </div>`;
    }).join('');

    const actionable = items.filter(i=>!i.divider);
    contextMenuEl.querySelectorAll('[data-action]').forEach((el,i)=>{
      el.addEventListener('click', ()=>{
        actionable[i].action();
        closeContextMenu();
      });
    });

    contextMenuEl.classList.add('show');
    const rect = contextMenuEl.getBoundingClientRect();
    let left = x, top = y;
    if(left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if(top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    contextMenuEl.style.left = left + 'px';
    contextMenuEl.style.top = top + 'px';
  }

  document.addEventListener('click', (e)=>{
    if(!contextMenuEl.contains(e.target)) closeContextMenu();
  });
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape') closeContextMenu();
  });
  window.addEventListener('scroll', closeContextMenu, true);

  async function editTask(listId, taskId){
    const list = activeProfile().lists.find(l=>l.id===listId);
    const task = list.tasks.find(t=>t.id===taskId);
    if(!task) return;
    const updated = await editDialog(task.text);
    if(updated === null) return;
    const trimmed = updated.trim();
    if(!trimmed) return;
    task.text = trimmed;
    saveState();
    render();
  }

  function copyTaskText(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).catch(()=>fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta);
  }

  let pinCycleIndex = {};

  function renderPinnedBar(list){
    const bar = document.getElementById('pinnedBar');
    const pinned = list.tasks.filter(t=>t.pinned).sort((a,b)=>a.ts-b.ts);

    if(pinned.length === 0){
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';

    let idx = pinCycleIndex[list.id] || 0;
    if(idx >= pinned.length) idx = 0;
    const current = pinned[idx];

    document.getElementById('pinnedBarLabel').textContent =
      pinned.length > 1 ? `Pinned task (${idx+1}/${pinned.length})` : 'Pinned task';
    document.getElementById('pinnedBarContent').textContent = current.text;

    bar.onclick = () => {
      pinCycleIndex[list.id] = (idx + 1) % pinned.length;
      const row = document.querySelector(`.msg-row[data-task-id="${current.id}"] .bubble`);
      if(row){
        row.scrollIntoView({behavior:'smooth', block:'center'});
        row.classList.add('flash');
        setTimeout(()=>row.classList.remove('flash'), 1000);
      }
      renderPinnedBar(list);
    };

    document.getElementById('pinnedBarClose').onclick = (e)=>{
      e.stopPropagation();
      togglePin(list.id, current.id);
    };
  }

  function render(){
    renderProfileMenu();
    renderSidebar();
    renderMain();
    if(window.innerWidth <= 760){
      const sidebar = document.getElementById('sidebar');
      const main = document.getElementById('main');
      if(activeProfile().activeListId){
        sidebar.classList.add('hidden');
        main.classList.remove('hidden');
      } else {
        sidebar.classList.remove('hidden');
        main.classList.add('hidden');
      }
    }
  }

  function toggleTask(listId, taskId){
    const list = activeProfile().lists.find(l=>l.id===listId);
    const task = list.tasks.find(t=>t.id===taskId);
    task.done = !task.done;
    task.ts = Date.now();
    pendingCheckToggleId = taskId;
    saveState();
    render();
  }

  function deleteTask(listId, taskId){
    const list = activeProfile().lists.find(l=>l.id===listId);
    const el = document.querySelector(`.msg-row[data-task-id="${taskId}"]`);
    animateRemoval([el], ()=>{
      list.tasks = list.tasks.filter(t=>t.id!==taskId);
      saveState();
      render();
    });
  }

  function togglePin(listId, taskId){
    const list = activeProfile().lists.find(l=>l.id===listId);
    const task = list.tasks.find(t=>t.id===taskId);
    task.pinned = !task.pinned;
    saveState();
    render();
  }

  function renameList(listId, name, color){
    const list = activeProfile().lists.find(l=>l.id===listId);
    if(!list) return;
    list.name = name.trim();
    list.color = color;
    saveState();
    render();
  }

  function addTask(text){
    const profile = activeProfile();
    const list = profile.lists.find(l=>l.id===profile.activeListId);
    if(!list || !text.trim()) return;
    const now = Date.now();
    const task = {id:uid(), text:text.trim(), done:false, ts:now, order:now, pinned:false};
    list.tasks.push(task);
    pendingTaskEnterId = task.id;
    saveState();
    render();
  }

  function clearDone(){
    const profile = activeProfile();
    const list = profile.lists.find(l=>l.id===profile.activeListId);
    if(!list) return;
    const doneIds = new Set(list.tasks.filter(t=>t.done).map(t=>t.id));
    if(!doneIds.size) return;
    const els = [...document.querySelectorAll('.msg-row')].filter(el=>doneIds.has(el.dataset.taskId));
    animateRemoval(els, ()=>{
      list.tasks = list.tasks.filter(t=>!doneIds.has(t.id));
      saveState();
      render();
    });
  }

  async function deleteList(){
    const profile = activeProfile();
    const list = profile.lists.find(l=>l.id===profile.activeListId);
    if(!list) return;
    if(!await confirmDialog(`Delete "${list.name}" and all its tasks?`)) return;
    const el = document.querySelector(`.chat-row[data-list-id="${list.id}"]`);
    animateRemoval([el], ()=>{
      profile.lists = profile.lists.filter(l=>l.id!==list.id);
      profile.activeListId = null;
      saveState();
      render();
    });
  }

  function createList(name, color){
    const profile = activeProfile();
    const maxOrder = profile.lists.reduce((m,l)=> Math.max(m, l.order ?? 0), -1);
    const list = {id:uid(), name: name.trim(), color, tasks:[], pinned:false, order: maxOrder + 1};
    profile.lists.push(list);
    profile.activeListId = list.id;
    pendingListEnterId = list.id;
    saveState();
    render();
  }

  function toggleListPin(listId){
    const list = activeProfile().lists.find(l=>l.id===listId);
    if(!list) return;
    list.pinned = !list.pinned;
    pendingPinToggleListId = listId;
    saveState();
    render();
  }

  function switchProfile(profileId){
    if(state.activeProfileId === profileId) { closeProfileMenu(); return; }
    state.activeProfileId = profileId;
    saveState();
    render();
    closeProfileMenu();
  }

  function createProfile(name, color){
    const profile = {id:uid(), name: name.trim(), color, lists:[], activeListId:null};
    state.profiles.push(profile);
    state.activeProfileId = profile.id;
    saveState();
    render();
    renderProfileMenu();
  }

  function renameProfile(profileId, name, color){
    const profile = state.profiles.find(p=>p.id===profileId);
    if(!profile) return;
    profile.name = name.trim();
    profile.color = color;
    saveState();
    render();
    renderProfileMenu();
  }

  async function deleteProfile(profileId){
    if(state.profiles.length <= 1) return;
    const profile = state.profiles.find(p=>p.id===profileId);
    if(!profile) return;
    if(!await confirmDialog(`Delete profile "${profile.name}" and all its lists and tasks?`)) return;
    state.profiles = state.profiles.filter(p=>p.id!==profileId);
    if(state.activeProfileId === profileId){
      state.activeProfileId = state.profiles[0].id;
    }
    saveState();
    render();
    renderProfileMenu();
  }

  document.getElementById('searchInput').addEventListener('input', renderSidebar);

  document.getElementById('sendBtn').addEventListener('click', submitTask);
  const taskInput = document.getElementById('taskInput');
  taskInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      submitTask();
    }
  });
  taskInput.addEventListener('input', ()=>{
    taskInput.style.height = 'auto';
    taskInput.style.height = Math.min(taskInput.scrollHeight, 120) + 'px';
  });
  function submitTask(){
    const val = taskInput.value;
    if(!val.trim()) return;
    addTask(val);
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.classList.remove('sent');
    // force reflow so re-adding the class restarts the animation
    void sendBtn.offsetWidth;
    sendBtn.classList.add('sent');
    taskInput.value = '';
    taskInput.style.height = 'auto';
  }

  document.getElementById('clearDoneBtn').addEventListener('click', clearDone);
  document.getElementById('deleteListBtn').addEventListener('click', deleteList);
  document.getElementById('backBtn').addEventListener('click', ()=>{ activeProfile().activeListId = null; render(); });

  const modalBackdrop = document.getElementById('modalBackdrop');
  const swatchesEl = document.getElementById('swatches');
  let selectedColor = COLORS[0];
  COLORS.forEach((c,i)=>{
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i===0 ? ' selected':'');
    sw.style.background = c;
    sw.addEventListener('click', ()=>{
      selectedColor = c;
      swatchesEl.querySelectorAll('.swatch').forEach(s=>s.classList.remove('selected'));
      sw.classList.add('selected');
    });
    swatchesEl.appendChild(sw);
  });

  let modalMode = 'list-create';
  let modalTargetId = null;

  function selectColorSwatch(color){
    selectedColor = color;
    const i = COLORS.indexOf(color);
    swatchesEl.querySelectorAll('.swatch').forEach((s,idx)=>s.classList.toggle('selected', idx===i));
  }

  function openModal(){
    modalMode = 'list-create';
    document.getElementById('modalTitle').textContent = 'New list';
    document.getElementById('newListName').placeholder = 'e.g. Groceries';
    document.getElementById('createListBtn').textContent = 'Create';
    document.getElementById('newListName').value = '';
    selectColorSwatch(COLORS[0]);
    modalBackdrop.classList.add('show');
    setTimeout(()=>document.getElementById('newListName').focus(), 50);
  }

  function openRenameModal(){
    const profile = activeProfile();
    const list = profile.lists.find(l=>l.id===profile.activeListId);
    if(!list) return;
    modalMode = 'list-rename';
    document.getElementById('modalTitle').textContent = 'Rename list';
    document.getElementById('createListBtn').textContent = 'Save';
    document.getElementById('newListName').value = list.name;
    selectColorSwatch(list.color);
    modalBackdrop.classList.add('show');
    setTimeout(()=>{
      const inp = document.getElementById('newListName');
      inp.focus();
      inp.select();
    }, 50);
  }

  function openProfileCreateModal(){
    modalMode = 'profile-create';
    modalTargetId = null;
    document.getElementById('modalTitle').textContent = 'New profile';
    document.getElementById('newListName').placeholder = 'e.g. Job tasks, YouTube videos';
    document.getElementById('createListBtn').textContent = 'Create';
    document.getElementById('newListName').value = '';
    selectColorSwatch(COLORS[0]);
    modalBackdrop.classList.add('show');
    setTimeout(()=>document.getElementById('newListName').focus(), 50);
  }

  function openProfileRenameModal(profileId){
    const profile = state.profiles.find(p=>p.id===profileId);
    if(!profile) return;
    modalMode = 'profile-rename';
    modalTargetId = profileId;
    document.getElementById('modalTitle').textContent = 'Rename profile';
    document.getElementById('createListBtn').textContent = 'Save';
    document.getElementById('newListName').value = profile.name;
    selectColorSwatch(profile.color);
    modalBackdrop.classList.add('show');
    setTimeout(()=>{
      const inp = document.getElementById('newListName');
      inp.focus();
      inp.select();
    }, 50);
  }

  function closeModal(){ modalBackdrop.classList.remove('show'); }

  document.getElementById('newListBtn').addEventListener('click', openModal);
  document.getElementById('renameListBtn').addEventListener('click', openRenameModal);
  document.getElementById('cancelModal').addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e)=>{ if(e.target === modalBackdrop) closeModal(); });
  document.getElementById('createListBtn').addEventListener('click', ()=>{
    const name = document.getElementById('newListName').value.trim();
    if(!name){ document.getElementById('newListName').focus(); return; }
    if(modalMode === 'list-rename'){
      renameList(activeProfile().activeListId, name, selectedColor);
    } else if(modalMode === 'profile-create'){
      createProfile(name, selectedColor);
    } else if(modalMode === 'profile-rename'){
      renameProfile(modalTargetId, name, selectedColor);
    } else {
      createList(name, selectedColor);
    }
    closeModal();
  });
  document.getElementById('newListName').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ document.getElementById('createListBtn').click(); }
  });

  const profileMenuEl = document.getElementById('profileMenu');

  function renderProfileMenu(){
    const profile = activeProfile();
    if(!profile) return;

    document.getElementById('profileMenuCurrentAvatar').style.background = profile.color;
    document.getElementById('profileMenuCurrentAvatar').textContent = initials(profile.name);
    document.getElementById('profileMenuCurrentName').textContent = profile.name;

    const listEl = document.getElementById('profileMenuList');
    listEl.innerHTML = '';

    state.profiles.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'profile-row' + (p.id === state.activeProfileId ? ' active' : '');

      const pendingTotal = p.lists.reduce((sum,l)=> sum + pendingCount(l), 0);

      row.innerHTML = `
        <div class="avatar" style="background:${p.color}">${initials(p.name)}</div>
        <div class="profile-row-name">${escapeHtml(p.name)}${pendingTotal ? ` <span style="color:var(--text-muted);font-weight:400;">(${pendingTotal})</span>` : ''}</div>
        <div class="profile-row-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="profile-row-actions">
          <button class="act-btn edit" title="Rename profile">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </button>
          ${state.profiles.length > 1 ? `
          <button class="act-btn del" title="Delete profile">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>` : ''}
        </div>
      `;

      if(p.id !== state.activeProfileId){
        row.querySelector('.profile-row-check').style.visibility = 'hidden';
      }

      row.addEventListener('click', ()=> switchProfile(p.id));
      row.querySelector('.edit').addEventListener('click', (e)=>{
        e.stopPropagation();
        openProfileRenameModal(p.id);
      });
      const delBtn = row.querySelector('.del');
      if(delBtn){
        delBtn.addEventListener('click', (e)=>{
          e.stopPropagation();
          deleteProfile(p.id);
        });
      }

      listEl.appendChild(row);
    });
  }

  function openProfileMenu(){
    renderProfileMenu();
    profileMenuEl.classList.add('show');
  }
  function closeProfileMenu(){
    profileMenuEl.classList.remove('show');
  }
  function toggleProfileMenu(){
    if(profileMenuEl.classList.contains('show')) closeProfileMenu();
    else openProfileMenu();
  }

  document.getElementById('profileMenuBtn').addEventListener('click', (e)=>{
    e.stopPropagation();
    toggleProfileMenu();
  });
  document.getElementById('profileMenuAddBtn').addEventListener('click', ()=>{
    closeProfileMenu();
    openProfileCreateModal();
  });
  document.addEventListener('click', (e)=>{
    if(!profileMenuEl.contains(e.target)) closeProfileMenu();
  });
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape') closeProfileMenu();
  });

  window.addEventListener('resize', render);

  (async function init(){
    state = await loadState();
    render();
  })();
})();