// Microsoft Teams adapter for content.js (new Teams on teams.microsoft.com / teams.cloud.microsoft): which elements
// are messages, their text, link and hover toolbar. Teams marks its UI with data-tid attributes. Every selector lives
// here so fixes are one-line; Shift+click the clock button to copy what the extension sees.
const TEAMS = {
  // One message in a chat or a channel conversation.
  row: "[data-tid='chat-pane-message'], [data-tid='channel-pane-message']",
  // The list item around a message (follow-up messages from the same person are separate items without a name).
  item: "[data-tid='chat-pane-item'], [data-tid='channel-pane-item']",
  sender: "[data-tid='message-author-name']",
  // Message body: id="content-<messageId>".
  text: "[id^='content-'], [data-tid='message-body-content']",
  // Hover toolbar (reactions + "More options"). Teams may render it next to the message rather than inside it.
  toolbar: "[role='toolbar'], [data-tid*='message-actions']",
  more: /^(more options|more actions|更多選項|其他選項|更多動作)/i,
  // The open conversation in the left-hand chat / channel list.
  selected: ["[role='treeitem'][aria-selected='true']", "[aria-current='page']", "[aria-current='true']", "[aria-selected='true']"],
  // Name of each conversation in that list; the element id carries the conversation id
  // (title-chat-list-item_19:…@thread.v2, title-channel-list-item-19:…@thread.tacv2).
  listTitle: "[id^='title-chat-list-item'], [id^='title-channel-list-item']",
  // The conversation view (its header shows the conversation name) and, inside it, the message list.
  view: "[data-tid='app-layout-area--unified-areas']",
  // Side panel showing one channel thread: its first message is the post the replies belong to.
  threadPane: "[data-tid='app-layout-area--end']",
  // "15 個回覆" button under a channel post, which opens its thread in that panel (id rc-sum-cont-btn-<post id>).
  replies: "[data-testid='replies_summary_container_button']",
  main: "[data-tid='app-layout-area--main']",
};
// Teams message ids are millisecond timestamps; conversation ids look like 19:…@thread.v2.
const TEAMS_MID = /^\d{10,}$/;
const TEAMS_THREAD = /19:[\w.-]+@(?:thread\.(?:v2|skype|tacv2)|unq\.gbl\.spaces)/;
const NEARBY_PX = 48;
const tidy1 = (s) => String(s || "").replace(/\s+/g, " ").trim();

function teamsKey(row) {
  const mid = row.getAttribute("data-mid");
  if (TEAMS_MID.test(mid || "")) return mid;
  const body = row.querySelector("[id^='content-']");
  const id = body ? body.id.slice("content-".length) : "";
  return TEAMS_MID.test(id) ? id : "";
}

function teamsRowOf(target) {
  const row = target.closest(TEAMS.row);
  return row && teamsKey(row) ? row : null;
}

function teamsSender(row) {
  const own = row.querySelector(TEAMS.sender);
  if (own) return tidy1(own.textContent);
  for (let el = row.closest(TEAMS.item), i = 0; el && i < 15; el = el.previousElementSibling, i++) {
    const s = el.querySelector(TEAMS.sender);
    if (s) return tidy1(s.textContent);
  }
  return "";
}

function teamsExtract(row) {
  const body = row.querySelector(TEAMS.text);
  const text = tidy1(body ? body.innerText || body.textContent : "").replace(/\s*(?:Edited|已編輯)\s*$/i, "");
  return { text: text || RTime.t("msg_fallback"), sender: teamsSender(row) };
}

const threadIn = (el) => {
  for (const a of el.attributes) {
    const m = TEAMS_THREAD.exec(a.value);
    if (m) return m[0];
  }
  return "";
};

// Text lines of the conversation header, in order: the conversation view's text outside the message list and the
// thread side panel (whose posts show people's names, which can match a 1:1 chat).
function teamsHeaderLines(row) {
  const view = row.closest(TEAMS.view);
  if (!view) return [];
  const skip = [...view.querySelectorAll(`${TEAMS.main}, ${TEAMS.threadPane}`)];
  const lines = [];
  const w = document.createTreeWalker(view, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (skip.some((el) => el.contains(n)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n && lines.length < 40; n = w.nextNode()) {
    const t = tidy1(n.nodeValue);
    if (t) lines.push(t);
  }
  return lines;
}

// The list doesn't mark the open conversation, but the header shows its name: take the list entry with exactly that
// name. Header lines are tried in order (the title comes first), and a line naming two different conversations gives
// nothing, rather than a guess.
function teamsThreadByTitle(row) {
  const byName = new Map();
  for (const el of document.querySelectorAll(TEAMS.listTitle)) {
    const id = threadIn(el);
    if (!id) continue;
    const name = tidy1(el.textContent);
    byName.set(name, (byName.get(name) || new Set()).add(id));
  }
  for (const line of teamsHeaderLines(row)) {
    const ids = byName.get(line);
    if (ids) return ids.size === 1 ? [...ids][0] : "";
  }
  return "";
}

// The conversation id isn't in the URL in new Teams (/v2/), so look for it, in order: the URL, the message's
// ancestors, the conversation selected in the chat / channel list (its list item carries the id), then the list
// entry named like the conversation header.
function teamsThread(row) {
  let m = TEAMS_THREAD.exec(decodeURIComponent(location.href));
  if (m) return m[0];
  for (let el = row, i = 0; el && i < 30; el = el.parentElement, i++) if ((m = threadIn(el))) return m;
  for (const sel of TEAMS.selected) {
    for (const el of document.querySelectorAll(sel)) {
      if ((m = threadIn(el))) return m;
      for (const child of el.querySelectorAll("*")) if ((m = threadIn(child))) return m;
    }
  }
  return teamsThreadByTitle(row);
}

const GUID = "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}";
// The chat list's folder entries carry "<tenantId>~<userId>~<folder>".
const TENANT_RE = new RegExp(`(${GUID})~${GUID}~`, "i");
// A team's id (the "groupId" of channel links), as it may appear on the team's entry in the channel list.
const TEAM_RE = new RegExp(`Team[^|/~]*\\|(${GUID})`, "i");
const isChannel = (thread) => /@thread\.(?:tacv2|skype)$/.test(thread);

function teamsTenant() {
  for (const el of document.querySelectorAll("[data-fui-tree-item-value]")) {
    const m = TENANT_RE.exec(el.getAttribute("data-fui-tree-item-value"));
    if (m) return m[1];
  }
  return "";
}

// The channel's entry in the left-hand list, and the team it sits under (id and name) from the entries around it.
function teamsChannelInfo(thread) {
  const title = [...document.querySelectorAll(TEAMS.listTitle)].find((el) => el.id.includes(thread));
  const info = { channelName: title ? tidy1(title.textContent) : "", groupId: "", teamName: "" };
  for (let el = title, i = 0; el && i < 20 && !info.groupId; el = el.parentElement, i++) {
    for (const a of el.attributes) {
      const m = TEAM_RE.exec(a.value);
      if (!m) continue;
      info.groupId = m[1];
      const name = el.querySelector("[id^='title-team'], [data-tid*='team-name']");
      info.teamName = name ? tidy1(name.textContent) : "";
      break;
    }
  }
  return info;
}

// Message, conversation and (for a channel reply) parent post from one of our links.
function teamsLocate(url) {
  const m = /\/l\/message\/([^/?#]+)\/(\d+)/.exec(url || "");
  if (!m) return null;
  const parent = new URL(url).searchParams.get("parentMessageId");
  const thread = decodeURIComponent(m[1]);
  if (TEAMS_THREAD.exec(thread)?.[0] !== thread) return null;
  return { key: m[2], thread, parentKey: parent && parent !== m[2] ? parent : "" };
}

// The conversation's entry in the left-hand chat / channel list (clicking it opens the conversation in place).
function teamsConversationEntry(target) {
  const t = target.thread; // checked against TEAMS_THREAD: no quotes or backslashes
  const title = document.querySelector(`[id="title-chat-list-item_${t}"], [id="title-channel-list-item-${t}"]`);
  return title && (title.closest("[role='treeitem']") || title);
}

// Open a channel post's thread in the side panel by clicking its replies button.
function teamsOpenThread(post) {
  const item = post.closest(TEAMS.item) || post;
  const button = item.querySelector(TEAMS.replies) || document.getElementById(`rc-sum-cont-btn-${teamsKey(post)}`);
  if (!button) return false;
  button.click();
  return true;
}

// The same links Teams' own "Copy link" makes, which Teams opens in place (a bare /l/message/<conversation>/<message>
// sends you to its "open the desktop app?" launcher page instead):
//   chat:    /l/message/<conversation>/<message>?context={"contextType":"chat"}
//   channel: /l/message/<conversation>/<message>?tenantId=…&groupId=…&parentMessageId=…&teamName=…&channelName=…&createdTime=…
// On the tab's own host (teams.microsoft.com or teams.cloud.microsoft).
function teamsPermalink(row) {
  const mid = teamsKey(row);
  const thread = teamsThread(row);
  if (!mid || !thread) return location.href; // conversation unknown: just bring Teams to the front
  const origin = /^https:\/\/teams\./.test(location.origin) ? location.origin : "https://teams.microsoft.com";
  const base = `${origin}/l/message/${thread}/${mid}`;
  if (!isChannel(thread)) return `${base}?context=${encodeURIComponent(JSON.stringify({ contextType: "chat" }))}`;
  const { channelName, groupId, teamName } = teamsChannelInfo(thread);
  const q = new URLSearchParams();
  const tenantId = teamsTenant();
  if (tenantId) q.set("tenantId", tenantId);
  if (groupId) q.set("groupId", groupId);
  // In the thread side panel the parent is the panel's first message; in the channel itself every message is a post.
  const pane = row.closest(TEAMS.threadPane);
  const first = pane && pane.querySelector(TEAMS.row);
  q.set("parentMessageId", (first && teamsKey(first)) || mid);
  if (teamName) q.set("teamName", teamName);
  if (channelName) q.set("channelName", channelName);
  q.set("createdTime", mid);
  return `${base}?${q}`;
}

const teamsLabel = (b) => (b.getAttribute("aria-label") || b.getAttribute("title") || "").trim();

// Our clock goes right before Teams' "More options" button: in the message itself, else the visible toolbar
// sitting on (or just above/below) the hovered message.
function teamsToolbarAnchor(row) {
  const r = row.getBoundingClientRect();
  let best = null;
  let bestDist = Infinity;
  for (const bar of document.querySelectorAll(TEAMS.toolbar)) {
    if (!bar.offsetParent) continue;
    const b = [...bar.querySelectorAll("button, [role='button']")].find((x) => TEAMS.more.test(teamsLabel(x)));
    if (!b) continue;
    if (row.contains(b)) return b;
    const box = b.getBoundingClientRect();
    const dist = box.bottom < r.top ? r.top - box.bottom : box.top > r.bottom ? box.top - r.bottom : 0;
    if (dist < bestDist) { best = b; bestDist = dist; }
  }
  return bestDist <= NEARBY_PX ? best : null;
}

// The message element is a row (avatar | bubble), so the label goes at the top of the bubble's column instead:
// the smallest element holding both the name/time line and the text. Follow-up messages have no name line, so
// there it's the text's parent.
function teamsLabelHost(row) {
  const body = row.querySelector(TEAMS.text);
  if (!body) return row;
  const head = row.querySelector(`${TEAMS.sender}, time`);
  let host = body.parentElement;
  if (head) while (host && host !== row && !host.contains(head)) host = host.parentElement;
  return host && row.contains(host) ? host : row;
}

const GCRSite = {
  id: "teams",
  toolbarSel: TEAMS.toolbar,
  senderSel: TEAMS.sender,
  rowOf: teamsRowOf,
  isToolbar: (el) => !!el.closest(TEAMS.toolbar),
  extract: teamsExtract,
  permalink: teamsPermalink,
  messageKey: teamsKey,
  rows: () => document.querySelectorAll(TEAMS.row),
  rowKey: teamsKey,
  labelHost: teamsLabelHost,
  labelClass: "gcr-label-teams",
  // Teams' own link handler opens the address it was drawn with, not the clicked element's, so a link of ours can't
  // go through it: reminders get to the message via the conversation list instead (no linkHosts).
  locate: teamsLocate,
  conversationEntry: teamsConversationEntry,
  openThread: teamsOpenThread,
  toolbarAnchor: teamsToolbarAnchor,
  debugInfo: (row) => ({
    thread: teamsThread(row) || null,
    headerLines: teamsHeaderLines(row).slice(0, 8),
    // Around the channel's list entry, to find the team id/name; and the message's ancestors up to the list, to find
    // how a reply's parent post is marked.
    channelEntry: (() => {
      const thread = teamsThread(row);
      const title = thread && [...document.querySelectorAll(TEAMS.listTitle)].find((el) => el.id.includes(thread));
      const out = [];
      for (let el = title, i = 0; el && i < 12; el = el.parentElement, i++) {
        const attrs = [...el.attributes].filter((a) => !/^(class|style|data-tabster)$/.test(a.name)).map((a) => `${a.name}=${a.value.slice(0, 160)}`);
        if (attrs.length) out.push(attrs);
      }
      return out;
    })(),
    messageAncestors: (() => {
      const out = [];
      for (let el = row.parentElement, i = 0; el && i < 12 && !el.matches(TEAMS.main); el = el.parentElement, i++) {
        const attrs = [...el.attributes].filter((a) => /^(data-tid|data-mid|id|role|aria-label|data-testid)$/.test(a.name)).map((a) => `${a.name}=${a.value.slice(0, 80)}`);
        if (attrs.length) out.push(attrs);
      }
      return out;
    })(),
    firstInList: (() => { const f = document.querySelector(TEAMS.row); return f ? teamsKey(f) : null; })(),
    tenantId: teamsTenant() || null,
    threadByTitle: teamsThreadByTitle(row) || null,
    // Conversation list entries named like a header line, and anything marked selected/current that holds an id.
    titleMatches: [...document.querySelectorAll(TEAMS.listTitle)]
      .filter((el) => teamsHeaderLines(row).includes(tidy1(el.textContent)))
      .map((el) => ({ name: tidy1(el.textContent).slice(0, 40), id: el.id.slice(0, 120) })),
    selectedLike: [...document.querySelectorAll("[aria-selected='true'], [aria-current]:not([aria-current='false']), [data-selected='true'], [aria-pressed='true']")]
      .filter((el) => threadIn(el) || [...el.querySelectorAll("*")].some(threadIn))
      .slice(0, 10)
      .map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), attrs: [...el.attributes].map((a) => `${a.name}=${a.value.slice(0, 40)}`).slice(0, 12) })),
    moreButtons: [...document.querySelectorAll("button[aria-label], [role='button'][aria-label]")]
      .filter((b) => TEAMS.more.test(teamsLabel(b)))
      .slice(0, 10)
      .map((b) => ({ label: teamsLabel(b), visible: !!b.offsetParent, inRow: row.contains(b), inToolbar: !!b.closest(TEAMS.toolbar) })),
  }),
};
