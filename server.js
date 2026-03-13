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

    // -- PHẦN THEO DÕI LOG BẮT TIN NHẮN TỪ BOT --
    // In ra text tin nhắn để kiểm tra
    if (text) console.log("📩 Tin nhắn từ Telegram:", text.substring(0, 50) + "...");

    // Cập nhật Số dư & NV
    if (text.includes("Số dư:") && text.includes("NV hôm nay:")) {
        const balanceMatch = text.match(/Số dư:\s*([\d,.]+)/i);
        const taskMatch = text.match(/NV hôm nay:\s*([\d]+\/[\d]+)/i);
        if (balanceMatch || taskMatch) {
            io.emit("update_stats", { 
                balance: balanceMatch ? balanceMatch[1] : null, 
                tasks: taskMatch ? taskMatch[1] : null 
            });
        }
    }

    // Cập nhật Top
    if (text.includes("Bảng xếp hạng")) {
        const rankMatch = text.match(/#(\d+)\s+Chungdacoeim/i);
        io.emit("update_rank", { rank: rankMatch ? rankMatch[1] : "Chưa lọt top" });
    }

    // Cập nhật trạng thái duyệt tiền
    if (text.includes("Admin đã duyệt nhiệm vụ của bạn!")) {
        console.log("✅ Bot đã duyệt nhiệm vụ!");
        io.emit("log_msg", "Nhiệm vụ hoàn thành!");
    }

    // -- SỬA LỖI ĐỌC NÚT BẤM (INLINE BUTTONS) --
    if (message.replyMarkup && message.replyMarkup.rows) {
        console.log("🔍 Phát hiện tin nhắn có chứa Nút bấm!");
        let taskUrl = "";
        let buttonData = null;

        message.replyMarkup.rows.forEach(row => {
            row.buttons.forEach(btn => {
                // Tùy phiên bản GramJS, text có thể nằm ở btn.text hoặc btn.button.text
                const btnText = btn.text || (btn.button && btn.button.text) || "";
                
                if (btnText.includes("Mở link") && btn.url) {
                    taskUrl = btn.url;
                    console.log("🔗 Lấy được URL:", taskUrl);
                }
                if (btnText.includes("Kiểm tra hoàn thành")) {
                    buttonData = btn.data;
                    console.log("💾 Lấy được Data nút Kiểm tra.");
                }
            });
        });

        if (taskUrl && buttonData) {
            pendingTasks[message.id] = { url: taskUrl, clickData: buttonData };
            console.log("🚀 Đang gửi link cho Extension mở tab...");
            
            // Ép gửi bằng Broadcast cho tất cả thiết bị
            io.sockets.emit("do_task", { messageId: message.id, url: taskUrl }); 
        }
    }
});

io.on('connection', (socket) => {
    console.log(`[+] Có thiết bị kết nối (ID: ${socket.id})`);

    socket.on('send_cmd', async (cmd) => {
        if (isAutoMode && (cmd === '/uptolink2step' || cmd === '/uptolink3step')) {
            // Tạm thời fix số lượng thiết bị là 1 để test tránh bị Telegram block do gửi lệnh quá nhanh
            const deviceCount = 1; 
            console.log(`[Auto] Đang gửi lệnh ${cmd}...`);
            await client.sendMessage(botUsername, { message: cmd });
        } else {
            console.log(`[Manual] Đang gửi lệnh ${cmd}...`);
            await client.sendMessage(botUsername, { message: cmd });
        }
    });

    socket.on('toggle_auto', (data) => {
        isAutoMode = data.isOn;
        autoDelay = data.delay;
        console.log(`⚙️ Auto mode: ${isAutoMode ? 'ON' : 'OFF'}, Delay: ${autoDelay}s`);
    });

    socket.on('target_reached', async (data) => {
        const msgId = data.messageId;
        console.log(`🎯 Extension báo đã đến đích! Chuẩn bị bấm nút cho tin nhắn ${msgId}...`);
        
        const task = pendingTasks[msgId];
        if (task && task.clickData) {
            try {
                await client.invoke(new Api.messages.GetBotCallbackAnswer({
                    peer: botUsername,
                    msgId: msgId,
                    data: task.clickData
                }));
                console.log(`✅ Đã gửi tín hiệu API bấm nút "Kiểm tra hoàn thành"!`);
                delete pendingTasks[msgId];
                
                setTimeout(() => client.sendMessage(botUsername, { message: '/view' }), 2000);
            } catch (err) { console.error("❌ Lỗi API bấm nút:", err); }
        }
    });
});

server.listen(3000, async () => {
    console.log('Server chạy port 3000');
    await startTelegram();
});
