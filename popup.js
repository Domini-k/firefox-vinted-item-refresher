function getVintedTab(cb) {
  chrome.tabs.query({ url: 'https://www.vinted.pl/*' }, function (tabs) {
    cb(tabs[0] || null);
  });
}

function readQueueCount(tabId, cb) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function () {
      var editJob = null, relistJob = null;
      try { editJob   = JSON.parse(localStorage.getItem('sah-edit-job'));   } catch (e) {}
      try { relistJob = JSON.parse(localStorage.getItem('sah-relist-job')); } catch (e) {}
      var editCount   = editJob   && editJob.queue   ? editJob.queue.length   : 0;
      var relistCount = relistJob ? 1 + (relistJob.queue ? relistJob.queue.length : 0) : 0;
      return editCount + relistCount;
    }
  }, function (results) {
    if (chrome.runtime.lastError || !results || !results[0]) { cb(null); return; }
    cb(results[0].result);
  });
}

function updateQueueDisplay(count) {
  var el = document.getElementById('pr-queue');
  if (count === null) {
    el.textContent = 'Queue: —';
    el.classList.remove('pr-queue--active');
  } else if (count === 0) {
    el.textContent = 'Queue: 0 jobs';
    el.classList.remove('pr-queue--active');
  } else {
    el.textContent = 'Queue: ' + count + (count === 1 ? ' job' : ' jobs');
    el.classList.add('pr-queue--active');
  }
}

function getPauseSeconds() {
  var input = document.getElementById('pr-pause');
  if (!input) return 0;
  var parsed = parseInt(input.value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function savePauseSeconds() {
  var value = getPauseSeconds();
  chrome.storage.local.set({ 'sah-job-pause-seconds': String(value) }, function () {
    var status = document.getElementById('pr-status');
    if (status) {
      status.textContent = value > 0 ? 'Pause between jobs: ' + value + 's' : 'Pause between jobs: off';
      status.style.color = '#09B1BA';
    }
  });
}

function loadPauseSeconds() {
  var input = document.getElementById('pr-pause');
  if (!input) return;
  chrome.storage.local.get('sah-job-pause-seconds', function (items) {
    var stored = items && items['sah-job-pause-seconds'];
    var parsed = parseInt(stored || '0', 10);
    input.value = Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : '0';
  });
}

// Init: page status + queue count
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  var status = document.getElementById('pr-status');
  var url = tabs[0] && tabs[0].url || '';
  if (url.includes('vinted.pl/member/')) {
    status.textContent = 'Active on this page. Use the VR button bottom-right.';
    status.style.color = '#09B1BA';
  } else {
    status.textContent = 'Navigate to your Vinted seller profile to use this extension.';
  }
});

loadPauseSeconds();
savePauseSeconds();

getVintedTab(function (tab) {
  if (!tab) { updateQueueDisplay(null); return; }
  readQueueCount(tab.id, updateQueueDisplay);
});

document.getElementById('pr-pause').addEventListener('change', savePauseSeconds);
document.getElementById('pr-pause').addEventListener('input', savePauseSeconds);

// Kill button
document.getElementById('pr-kill').addEventListener('click', function () {
  var btn      = document.getElementById('pr-kill');
  var feedback = document.getElementById('pr-kill-feedback');
  btn.disabled = true;

  getVintedTab(function (tab) {
    if (!tab) {
      feedback.textContent = 'No Vinted tab open.';
      feedback.style.color = '#DC2626';
      btn.disabled = false;
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function () {
        localStorage.removeItem('sah-edit-job');
        localStorage.removeItem('sah-relist-job');
        try { sessionStorage.removeItem('sah-relist-advance'); } catch (e) {}
        try { sessionStorage.removeItem('sah-edit-advance');   } catch (e) {}
      }
    }, function () {
      if (chrome.runtime.lastError) {
        feedback.textContent = 'Error: ' + chrome.runtime.lastError.message;
        feedback.style.color = '#DC2626';
        btn.disabled = false;
        return;
      }
      feedback.textContent = 'All jobs cleared.';
      feedback.style.color = '#09B1BA';
      btn.disabled = false;
      updateQueueDisplay(0);
    });
  });
});
