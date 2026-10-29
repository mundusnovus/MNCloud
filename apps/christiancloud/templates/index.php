<?php /** @var array $_ */ ?>
<div id="christian-cloud" data-uid="<?php p($_['uid']); ?>">
<a class="skip" href="#files">Skip to files</a>
<header class="top"><a class="identity" href="/"><img src="/custom_apps/christiancloud/img/cloud-icon.svg" alt="" width="40" height="40">Christian Cloud</a><nav aria-label="Christian Systems"><a href="https://office.christiansystems.org">Office</a><a href="https://christiansystems.org">Christian Systems</a><button id="theme" aria-label="Change color theme">Theme</button></nav></header>
<div class="workspace"><aside><h2>Your space</h2><button id="all-files" aria-current="page">Files</button><button id="trash">Trash</button><div class="storage"><label for="quota">Storage</label><meter id="quota" min="0" max="3000000000" value="0"></meter><p id="quota-text">Loading…</p><p>3 GB for your account.</p></div><a href="https://christiansystems.org/downloads/">Sync this computer</a></aside>
<main id="files" tabindex="-1"><div class="heading"><div><p class="eyebrow">CHRISTIAN CLOUD</p><h1 id="folder-title">Your files</h1></div><div class="actions"><button id="new-folder">New folder</button><label class="primary upload">Upload<input id="upload" type="file" multiple></label></div></div>
<nav id="breadcrumbs" aria-label="Folder path"></nav>
<label class="search">Find a file<input id="search" type="search" placeholder="Search this folder" autocomplete="off"></label>
<p id="status" role="status" aria-live="polite"></p><progress id="progress" hidden></progress>
<div class="table-scroll"><table><thead><tr><th scope="col">Name</th><th scope="col">Size</th><th scope="col">Changed</th><th scope="col">Actions</th></tr></thead><tbody id="rows"></tbody></table></div>
<div id="empty" hidden><img src="/custom_apps/christiancloud/img/cloud-mark.svg" alt="" width="80" height="80"><h2>Room for your work.</h2><p>Upload a file or make a folder.</p></div>
</main></div><footer>Christian Cloud · <a href="https://github.com/christiansystems/ChristianCloud">Source</a> · <a href="/custom_apps/christiancloud/NOTICE.txt">About and licenses</a></footer>
<dialog id="dialog"><form method="dialog"><h2 id="dialog-title"></h2><label id="dialog-label" for="dialog-input"></label><input id="dialog-input" required><p id="dialog-help"></p><div class="actions"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Continue</button></div></form></dialog>
</div>
