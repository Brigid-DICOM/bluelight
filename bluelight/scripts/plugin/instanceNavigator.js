/**
 * Instance Navigator
 * 處理 URL 中指定的 SOPInstanceUID，當影像載入後提示用戶跳轉
 * 適用於一般模式和 Share 模式
 */
window.InstanceNavigator = {
    specifiedSopUid: null,
    notificationShown: false,
    watchInterval: null,
    maxWatchTime: 5 * 60 * 1000, // 最長監聽 5 分鐘
    watchStartTime: null,

    /**
     * 初始化 - 從 URL 讀取 SOP Instance UID 並開始監聽
     */
    init() {
        this.parsedUrlParams();

        if (this.specifiedSopUid) {
            console.log(
                "[InstanceNavigator] Watching for SOPInstanceUID:",
                this.specifiedSopUid
            );
            this.startWatch();
        }
    },

    parsedUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        this.specifiedSopUid = urlParams.get("SOPInstanceUID") || null;
    },

    /**
     * 開始監聽指定的 Instance 是否已載入
     */
    startWatch() {
        if (!this.specifiedSopUid) return;

        this.watchStartTime = Date.now();

        this.watchInterval = setInterval(() => {
            this.checkForSpecifiedSop();
        }, 500);
    },

    stopWatch() {
        if (this.watchInterval) {
            clearInterval(this.watchInterval);
            this.watchInterval = null;
        }
    },

    checkForSpecifiedSop() {
        if (Date.now() - this.watchStartTime > this.maxWatchTime) {
            console.log("[InstanceNavigator] Watch timeout, stopping...");
            this.stopWatch();
            return;
        }

        if (this.notificationShown) {
            this.stopWatch();
            return;
        }

        if (typeof ImageManager === "undefined" || !ImageManager.SopMap) {
            return;
        }

        const sop =
            ImageManager.SopMap[this.specifiedSopUid] ||
            ImageManager.findSop(this.specifiedSopUid);

        if (sop) {
            this.notificationShown = true;
            this.stopWatch();
            this.showNotification(sop);
        }
    },

    /**
     * 顯示跳轉通知
     * @param {*} sop
     */
    showNotification(sop) {
        // 移除已存在的通知
        const existing = document.getElementById(
            "instanceNavigatorNotification"
        );
        if (existing) existing.remove();

        // 取得 header 元素
        const header = document.getElementById("page-header");
        if (!header) {
            console.warn("[InstanceNavigator] Header element not found");
            return;
        }

        // 創建通知容器
        const notification = document.createElement("div");
        notification.id = "instanceNavigatorNotification";
        notification.style.cssText = `
             width: 100%;
             background-color: rgba(30, 60, 90, 0.95);
             color: #fff;
             padding: 8px 16px;
             display: flex;
             align-items: center;
             justify-content: center;
             gap: 8px;
             font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft JhengHei', sans-serif;
             font-size: 14px;
             box-sizing: border-box;
         `;

        // 文字訊息
        const message = document.createElement("span");
        message.textContent = "🎯 Target Instance Found, ";
        message.style.cssText = "color: #fff;";

        // 前往連結按鈕（link style）
        const jumpLink = document.createElement("a");
        jumpLink.textContent = "Click here to jump";
        jumpLink.href = "#";
        jumpLink.style.cssText = `
             color: #63B3ED;
             text-decoration: underline;
             cursor: pointer;
             font-weight: 500;
         `;
        jumpLink.onmouseover = () => {
            jumpLink.style.color = "#90CDF4";
        };
        jumpLink.onmouseout = () => {
            jumpLink.style.color = "#63B3ED";
        };
        jumpLink.onclick = (e) => {
            e.preventDefault();
            this.jumpToInstance(sop);
            this.dismissNotification(notification);
        };

        // 關閉按鈕（link style）
        const closeLink = document.createElement("a");
        closeLink.textContent = "Close";
        closeLink.href = "#";
        closeLink.style.cssText = `
             color: #A0AEC0;
             text-decoration: underline;
             cursor: pointer;
             margin-left: 16px;
         `;
        closeLink.onmouseover = () => {
            closeLink.style.color = "#CBD5E0";
        };
        closeLink.onmouseout = () => {
            closeLink.style.color = "#A0AEC0";
        };
        closeLink.onclick = (e) => {
            e.preventDefault();
            this.dismissNotification(notification);
        };

        notification.appendChild(message);
        notification.appendChild(jumpLink);
        notification.appendChild(closeLink);

        // 加入 header 最底部
        header.appendChild(notification);

        console.log(
            "[InstanceNavigator] Notification shown for SOP:",
            sop.SOPInstanceUID
        );
    },

    dismissNotification(notification) {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.2s ease-out';
        setTimeout(() => notification.remove(), 200);
    },

    jumpToInstance(sop) {
        if (!sop) {
            console.warn("[InstanceNavigator] No SOP provided for jump");
            return;
        }

        try {
            if (typeof resetViewport === "function") resetViewport();

            if (typeof GetViewport === "function")
                GetViewport().loadImgBySop(sop);

            if (
                sop.parent &&
                sop.parent.SeriesInstanceUID &&
                typeof leftLayout !== "undefined"
            ) {
                leftLayout.setAccent(sop.parent.SeriesInstanceUID);
            }

            console.log(
                "[InstanceNavigator] Jumped to instance:",
                sop.SOPInstanceUID
            );
        } catch (error) {
            console.error(
                "[InstanceNavigator] Error jumping to instance:",
                error
            );
        }
    },

    triggerCheck() {
        if (!this.notificationShown && this.specifiedSopUid) {
            this.checkForSpecifiedSop();
        }
    },

    reset() {
        this.stopWatch();
        this.notificationShown = false;
        this.specifiedSopUid = null;

        const notification = document.getElementById(
            "instanceNavigatorNotification"
        );
        if (notification) notification.remove();
    }
};

onloadFunction.push(function () {
    window.InstanceNavigator.init();
});
