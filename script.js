// Thay bằng URL Render.com sau khi deploy. Hiện tại để localhost
const socket = io("https://superbot-lo8u.onrender.com"); 

// --- Cập nhật giao diện ---
socket.on("update_stats", (data) => {
    if(data.balance) document.getElementById('balance').innerText = data.balance;
    if(data.tasks) document.getElementById('tasks').innerText = data.tasks;
});
socket.on("update_rank", (data) => {
    if(data.rank) document.getElementById('rank').innerText = "#" + data.rank;
});
socket.on("show_money_alert", () => {
    document.getElementById('alert-overlay').classList.remove('hidden');
});

document.getElementById('btn-alert-ok').onclick = () => {
    document.getElementById('alert-overlay').classList.add('hidden');
};

// --- Bắt sự kiện bấm nút ---
const buttons = {
    'btn-up2': '/uptolink2step',
    'btn-up3': '/uptolink3step',
    'btn-view': '/view',
    'btn-top': '/top',
    'btn-withdraw': '/withdraw',
    'btn-spin': '/spin'
};

for (const [id, cmd] of Object.entries(buttons)) {
    document.getElementById(id).onclick = () => socket.emit('send_cmd', cmd);
}

// --- Toggle Auto ---
document.getElementById('auto-pplink').onchange = (e) => {
    const isChecked = e.target.checked;
    const delay = parseInt(document.getElementById('delay-input').value) || 5;
    socket.emit('toggle_auto', { isOn: isChecked, delay: delay });
};
