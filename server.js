require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

const app = express();
app.use(cors());
app.use(express.static(__dirname)); 
app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const apiId = parseInt(process.env.API_ID); 
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || "");

const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

let botUsername = "CryptoMoney_Bot";
let pendingTasks = {}; 
let isAutoMode = false;
let autoDelay = 5; 

async function startTelegram() {
    await client.start({
        phoneNumber: async () => await input.text("SĐT: "),
        password: async () => await input.text("2FA: "),
        phoneCode: async () => await input.text("OTP: "),
        onError: (err) => console.log(err),
    });
    console.log("✅ Đã kết nối Telegram!");
}

client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message) return;
    const text = message.message || "";

    // 🔴 SỬA LỖI 4: ĐỌC SỐ DƯ & NHIỆM VỤ (/view)
    if (text.includes("Số dư:") && text.includes("NV hôm nay:")) {
        // Dùng Regex \s*([\d,.]+) để lấy mọi con số sau chữ Số dư:
        const balanceMatch = text.match(/Số dư:\s*([\d,.]+)/i);
        const taskMatch = text.match(/NV hôm nay:\s*([\d]+\/[\d]+)/i);
        
        if (balanceMatch || taskMatch) {
            io.emit("update_stats", { 
                balance: balanceMatch ? balanceMatch[1] : null, 
                tasks: taskMatch ? taskMatch[1] : null 
            });
        }
    }

    // 🔴 SỬA LỖI 5: ĐỌC BẢNG XẾP HẠNG (/top) CỦA BẠN
    if (text.includes("Bảng xếp hạng")) {
        // Tìm chữ # kèm số, theo sau là khoảng trắng và tên Chungdacoeim
        const rankMatch = text.match(/#(\d+)\s+Chungdacoeim/i);
        if (rankMatch) {
            io.emit("update_rank", { rank: rankMatch[1] }); // Gửi thứ hạng về Web
        } else {
            io.emit("update_rank", { rank: "Chưa lọt top" });
        }
    }

    // Bắt nút Inline Keyboard (Lấy link và data nút Hoàn thành)
    if (message.replyMarkup && message.replyMarkup.rows) {
        let taskUrl = "";
        let buttonData = null;

        message.replyMarkup.rows.forEach(row => {
            row.buttons.forEach(btn => {
                if (btn.text.includes("Mở link") && btn.url) taskUrl = btn.url;
                if (btn.text.includes("Kiểm tra hoàn thành")) buttonData = btn.data;
            });
        });

        if (taskUrl && buttonData) {
            pendingTasks[message.id] = { url: taskUrl, clickData: buttonData };
            io.emit("do_task", { messageId: message.id, url: taskUrl }); 
        }
    }

    // Bắt duyệt tiền
    if (text.includes("Admin đã duyệt nhiệm vụ của bạn!")) {
        io.emit("log_msg", "Nhiệm vụ hoàn thành!");
    }
});

io.on('connection', (socket) => {
    console.log(`[+] Có thiết bị kết nối`);

    // 🔴 SỬA LỖI 1: LOGIC AUTO-PPLINK KHI BẤM NÚT
    socket.on('send_cmd', async (cmd) => {
        // Nếu đang bật Auto VÀ bấm nút uptolink
        if (isAutoMode && (cmd === '/uptolink2step' || cmd === '/uptolink3step')) {
            // Đếm số lượng máy (tab) đang kết nối tới server
            const deviceCount = io.engine.clientsCount; 
            console.log(`[Auto] Đang gửi ${deviceCount} lệnh cho ${deviceCount} thiết bị...`);
            
            for(let i = 0; i < deviceCount; i++) {
                await client.sendMessage(botUsername, { message: cmd });
                // Delay giữa các lệnh
                if (i < deviceCount - 1) await new Promise(r => setTimeout(r, autoDelay * 1000));
            }
        } else {
            // Nếu không bật Auto thì gửi bình thường 1 lệnh
            await client.sendMessage(botUsername, { message: cmd });
        }
    });

    // Chỉ lưu trạng thái On/Off, KHÔNG gửi lệnh tự động ở đây nữa
    socket.on('toggle_auto', (data) => {
        isAutoMode = data.isOn;
        autoDelay = data.delay;
    });

    // Nhận tín hiệu URL đích từ Extension và bấm nút trên Telegram
    socket.on('target_reached', async (data) => {
        const msgId = data.messageId;
        const task = pendingTasks[msgId];
        if (task && task.clickData) {
            console.log(`Đang bấm nút kiểm tra hoàn thành cho tin nhắn ${msgId}...`);
            try {
                await client.invoke(new Api.messages.GetBotCallbackAnswer({
                    peer: botUsername,
                    msgId: msgId,
                    data: task.clickData
                }));
                delete pendingTasks[msgId];
                
                // Cập nhật lại stats sau khi xong 1 link
                setTimeout(() => client.sendMessage(botUsername, { message: '/view' }), 2000);
            } catch (err) { console.error("Lỗi API bấm nút:", err); }
        }
    });
});

server.listen(3000, async () => {
    console.log('Server chạy port 3000');
    await startTelegram();
});
