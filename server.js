require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const requestIp = require('request-ip');

// Thư viện Telegram (GramJS)
const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input"); // Để nhập code OTP ở terminal lần đầu

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- CẤU HÌNH TELEGRAM ---
const apiId = parseInt(process.env.API_ID); // Sẽ setup ở file .env
const apiHash = process.env.API_HASH;
// Lấy session từ biến môi trường (dùng khi deploy), nếu không có thì tạo mới (chạy local)
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || "");

const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

// Biến lưu trữ trạng thái
let botUsername = "CryptoMoney_Bot";
let pendingTasks = {}; // Lưu { messageId: { url, clickData } }
let withdrawState = "IDLE";
let currentBalance = 0;
let isAutoMode = false;
let autoDelay = 5; // Giây

// --- KẾT NỐI TELEGRAM ---
async function startTelegram() {
    await client.start({
        phoneNumber: async () => await input.text("Nhập số điện thoại (VD: +84987...): "),
        password: async () => await input.text("Nhập mật khẩu 2FA (nếu có): "),
        phoneCode: async () => await input.text("Nhập mã OTP Telegram gửi về: "),
        onError: (err) => console.log("Lỗi Telegram:", err),
    });
    console.log("✅ Đã đăng nhập Telegram thành công!");
    
    // RẤT QUAN TRỌNG: Lưu chuỗi này lại để lát điền vào Render.com
    console.log("🔑 STRING SESSION CỦA BẠN (LƯU LẠI ĐỂ DEPLOY):");
    console.log(client.session.save());
}

// --- LẮNG NGHE TIN NHẮN TỪ BOT ---
client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message || message.peerId.userId?.toString() !== "ID_CỦA_BOT") return; // Lọc tin nhắn (Cần check ID thật của bot sau)
    
    const text = message.message || "";

    // 1. Quét Số dư & Nhiệm vụ
    if (text.includes("Số dư:") && text.includes("NV hôm nay:")) {
        const balance = text.match(/Số dư:\s*(\d+)đ/i)?.[1];
        const tasks = text.match(/NV hôm nay:\s*(\d+\/\d+)/i)?.[1];
        io.emit("update_stats", { balance, tasks });
    }

    // 2. Quét nút "Mở link" và "Kiểm tra hoàn thành"
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
            // Phát link cho các thiết bị (Extensions)
            distributeLink(message.id, taskUrl);
        }
    }

    // 3. Quét duyệt thành công
    if (text.includes("Admin đã duyệt nhiệm vụ của bạn!")) {
        io.emit("log_msg", "Nhiệm vụ hoàn thành! +Tiền");
        // Nếu đang bật Auto, xin link mới
        if (isAutoMode) {
            setTimeout(async () => {
                await client.sendMessage(botUsername, { message: '/uptolink2step' });
            }, autoDelay * 1000);
        }
    }

    // 4. Logic Rút Tiền
    if (text.includes("Nhập tên ngân hàng")) {
        withdrawState = "BANK";
        currentBalance = text.match(/Số dư:\s*(\d+)đ/i)?.[1] || 0;
        await client.sendMessage(botUsername, { message: 'Momo' });
    } else if (withdrawState === "BANK" && text.includes("Nhập tên chủ tài khoản")) {
        withdrawState = "NAME";
        await client.sendMessage(botUsername, { message: 'DANG VAN CHUNG' });
    } else if (withdrawState === "NAME" && text.includes("Nhập số tiền muốn rút")) {
        withdrawState = "IDLE";
        await client.sendMessage(botUsername, { message: currentBalance.toString() });
    } else if (text.includes("đã được duyệt!")) {
        io.emit("show_money_alert");
    }
});

// --- SOCKET.IO LẮNG NGHE TỪ DASHBOARD & EXTENSION ---
io.on('connection', (socket) => {
    const clientIp = requestIp.getClientIp(socket.request);
    console.log(`[+] Thiết bị kết nối: ${socket.id} (IP: ${clientIp})`);

    // Lệnh từ Dashboard
    socket.on('send_cmd', async (cmd) => {
        await client.sendMessage(botUsername, { message: cmd });
    });

    socket.on('toggle_auto', (data) => {
        isAutoMode = data.isOn;
        autoDelay = data.delay;
        if (isAutoMode) {
            // Đếm thiết bị (chỉ tính extension) và gửi lệnh xin link
            client.sendMessage(botUsername, { message: '/uptolink2step' });
        }
    });

    // Extension báo đã xem xong link (chờ tab đổi url)
    socket.on('target_reached', async (data) => {
        const msgId = data.messageId;
        const task = pendingTasks[msgId];
        if (task && task.clickData) {
            console.log(`Bấm nút kiểm tra cho tin nhắn ${msgId}...`);
            try {
                // API Gửi tín hiệu bấm nút "Kiểm tra hoàn thành"
                await client.invoke(new Api.messages.GetBotCallbackAnswer({
                    peer: botUsername,
                    msgId: msgId,
                    data: task.clickData
                }));
                delete pendingTasks[msgId];
            } catch (err) { console.error("Lỗi bấm nút:", err); }
        }
    });
});

// Hàm chia link cho extension
function distributeLink(messageId, url) {
    // Phát cho tất cả extension (Broadcast). Extension nào rảnh sẽ nhận.
    // Trong thực tế cần logic array quản lý thiết bị rảnh/bận chi tiết hơn.
    io.emit("do_task", { messageId, url }); 
}

// Khởi chạy
server.listen(3000, async () => {
    console.log('Server chạy tại http://localhost:3000');
    await startTelegram();
});