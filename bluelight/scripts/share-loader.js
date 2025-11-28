/**
 * Share DICOM Loader
 * 處理透過 shareToken 載入共享 DICOM 影像
 */
window.ShareDicomLoader = {
    shareToken: null,
    password: null,
    shareInfo: null,
    specifiedSeriesUid: null,
    specifiedSopUid: null,

    /**
     * 從 URL 取得 shareToken 和 password
     */
    getShareParams() {
        const urlParams = new URLSearchParams(window.location.search);
        this.shareToken = urlParams.get("shareToken");
        this.password = urlParams.get("password") || "";
        this.specifiedSeriesUid = urlParams.get("SeriesInstanceUID") || null;
        this.specifiedSopUid = urlParams.get("SOPInstanceUID") || null;
        return this.shareToken;
    },

    /**
     * 取得 share link 資訊
     */
    async fetchShareInfo() {
        if (!this.shareToken) return null;

        const url = `${window.location.origin}/api/share/${this.shareToken}${this.password ? `?password=${encodeURIComponent(this.password)}` : ""}`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to fetch share link");
            }
            const result = await response.json();
            if (!result.ok) {
                throw new Error(result.error || "Share link not accessible");
            }
            this.shareInfo = result.data;
            return this.shareInfo;
        } catch (error) {
            console.error("Failed to fetch share info:", error);
            showDicomStatus("Error: " + error.message, true);
            return null;
        }
    },

    /**
     * 根據 targetType 載入對應的資料
     */
    async loadByTargetType() {
        if (!this.shareInfo) return;

        const { targetType, targets } = this.shareInfo;
        showDicomStatus("Loading shared images...");

        if (this.specifiedSopUid && (targetType === "study" || targetType === "series")) {
            await this.loadSpecifiedInstances(targets, targetType);
            return;
        }
        
        if (this.specifiedSeriesUid && targetType === "instance") {
            await this.loadSpecifiedSeries(targets);
            return;
        }

        switch (targetType) {
            case "study":
                await this.loadStudies(targets);
                break;
            case "series":
                await this.loadSeries(targets);
                break;
            case "instance":
                await this.loadInstances(targets);
                break;
            default:
                console.error("Unknown target type:", targetType);
                showDicomStatus("Error: Unknown share type", true);
        }
    },

    /**
     * 載入 Study 類型的分享
     */
    async loadStudies(targets) {
        for (const target of targets) {
            const studyUid = target.targetId;
            
            // 取得 study 下所有的 series
            const seriesList = await this.fetchStudySeries(studyUid);
            if (!seriesList || seriesList.length === 0) continue;

            for (const series of seriesList) {
                const seriesUid = series["0020000E"]?.Value?.[0];
                if (!seriesUid) continue;

                // 取得 series 下的 instances 來計算總數
                const instances = await this.fetchSeriesInstances(studyUid, seriesUid);
                if (instances && instances.length > 0) {
                    window.SeriesProgressManager.setTotal(seriesUid, instances.length);
                }

                // 使用 WADO-RS 載入整個 series
                await this.loadSeriesWadoRs(studyUid, seriesUid, instances);
            }
        }
    },

    /**
     * 載入 Series 類型的分享
     */
    async loadSeries(targets) {
        // 對於 series 類型，需要先取得 series 資訊來得知 studyUid
        const seriesListUrl = `${window.location.origin}/api/share/${this.shareToken}/series${this.password ? `?password=${encodeURIComponent(this.password)}` : ""}`;
        
        try {
            const response = await fetch(seriesListUrl);
            if (!response.ok) throw new Error("Failed to fetch series list");
            
            const seriesList = await response.json();
            
            for (const series of seriesList) {
                const studyUid = series["0020000D"]?.Value?.[0];
                const seriesUid = series["0020000E"]?.Value?.[0];
                if (!studyUid || !seriesUid) continue;

                // 取得 series 下的 instances 來計算總數
                const instances = await this.fetchSeriesInstances(studyUid, seriesUid);
                if (instances && instances.length > 0) {
                    window.SeriesProgressManager.setTotal(seriesUid, instances.length);
                }

                await this.loadSeriesWadoRs(studyUid, seriesUid, instances);
            }
        } catch (error) {
            console.error("Failed to load series:", error);
            showDicomStatus("Error loading series: " + error.message, true);
        }
    },

    /**
     * 載入 Instance 類型的分享
     */
    async loadInstances(targets) {
        // 取得 instance 列表
        const instancesUrl = `${window.location.origin}/api/share/${this.shareToken}/instances${this.password ? `?password=${encodeURIComponent(this.password)}` : ""}`;
        
        try {
            const response = await fetch(instancesUrl);
            if (!response.ok) throw new Error("Failed to fetch instances");
            
            const instances = await response.json();
            
            // 按 series 分組 instances
            const groupedBySeries = {};
            for (const instance of instances) {
                const seriesUid = instance["0020000E"]?.Value?.[0];
                if (!seriesUid) continue;
                
                if (!groupedBySeries[seriesUid]) {
                    groupedBySeries[seriesUid] = {
                        studyUid: instance["0020000D"]?.Value?.[0],
                        instances: []
                    };
                }
                groupedBySeries[seriesUid].instances.push(instance);
            }

            // 設置每個 series 的進度
            for (const seriesUid of Object.keys(groupedBySeries)) {
                window.SeriesProgressManager.setTotal(seriesUid, groupedBySeries[seriesUid].instances.length);
            }

            // 逐一載入每個 instance
            for (const seriesUid of Object.keys(groupedBySeries)) {
                const { studyUid, instances: seriesInstances } = groupedBySeries[seriesUid];
                
                for (let i = 0; i < seriesInstances.length; i++) {
                    const instance = seriesInstances[i];
                    const sopUid = instance["00080018"]?.Value?.[0];
                    if (!sopUid) continue;

                    const isFirst = (i === 0);
                    await this.loadInstanceWadoRs(studyUid, seriesUid, sopUid, !isFirst);
                }
            }
        } catch (error) {
            console.error("Failed to load instances:", error);
            showDicomStatus("Error loading instances: " + error.message, true);
        }
    },

    /**
     * 取得 Study 下的 Series 列表
     */
    async fetchStudySeries(studyUid) {
        const url = `${window.location.origin}/api/share/${this.shareToken}/studies/${studyUid}/series${this.password ? `?password=${encodeURIComponent(this.password)}` : ""}`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) return [];
            return await response.json();
        } catch (error) {
            console.error("Failed to fetch study series:", error);
            return [];
        }
    },

    /**
     * 取得 Series 下的 Instances 列表
     */
    async fetchSeriesInstances(studyUid, seriesUid) {
        const url = `${window.location.origin}/api/share/${this.shareToken}/studies/${studyUid}/series/${seriesUid}/instances${this.password ? `?password=${encodeURIComponent(this.password)}` : ""}`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) return [];
            return await response.json();
        } catch (error) {
            console.error("Failed to fetch series instances:", error);
            return [];
        }
    },

    /**
     * 使用 WADO-RS 載入整個 Series
     * 這裡改為逐一載入 instance，以便追蹤進度
     */
    async loadSeriesWadoRs(studyUid, seriesUid, instances) {
        if (!instances || instances.length === 0) return;

        // 排序：取得最小 Instance Number 的作為首張
        let minInstanceNum = Number.MAX_VALUE;
        let firstInstanceIndex = 0;
        
        for (let i = 0; i < instances.length; i++) {
            const instanceNum = instances[i]["00200013"]?.Value?.[0];
            if (instanceNum !== undefined && instanceNum < minInstanceNum) {
                minInstanceNum = instanceNum;
                firstInstanceIndex = i;
            }
        }

        // 先載入首張影像
        const firstInstance = instances[firstInstanceIndex];
        const firstSopUid = firstInstance["00080018"]?.Value?.[0];
        if (firstSopUid) {
            await this.loadInstanceWadoRs(studyUid, seriesUid, firstSopUid, false);
        }

        // 載入其餘影像
        for (let i = 0; i < instances.length; i++) {
            if (i === firstInstanceIndex) continue;
            
            const sopUid = instances[i]["00080018"]?.Value?.[0];
            if (sopUid) {
                this.loadInstanceWadoRs(studyUid, seriesUid, sopUid, true);
            }
        }
    },

    /**
     * 使用 WADO-RS 載入單一 Instance
     */
    loadInstanceWadoRs(studyUid, seriesUid, sopUid, onlyLoad = false) {
        const url = `${window.location.origin}/api/share/${this.shareToken}/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}${this.password ? `?password=${encodeURIComponent(this.password)}` : ""}`;
        
        // 使用 viewer.js 中的 wadorsLoader，但需要調整 token 處理
        this.shareWadorsLoader(url, onlyLoad);
    },
    
    /**
     * 載入 URL 中指定的 Series（僅當 targetType 為 study 時）
     */
    async loadSpecifiedSeries(targets) {
        const specifiedSeriesUids = this.specifiedSeriesUid.split(",").map(uid => uid.trim());
        
        for (const target of targets) {
            const studyUid = target.targetId;
            
            // 取得 study 下所有的 series
            const seriesList = await this.fetchStudySeries(studyUid);
            if (!seriesList || seriesList.length === 0) continue;

            // 只處理指定的 series
            for (const series of seriesList) {
                const seriesUid = series["0020000E"]?.Value?.[0];
                if (!seriesUid || !specifiedSeriesUids.includes(seriesUid)) continue;

                const instances = await this.fetchSeriesInstances(studyUid, seriesUid);
                if (instances && instances.length > 0) {
                    window.SeriesProgressManager.setTotal(seriesUid, instances.length);
                }

                await this.loadSeriesWadoRs(studyUid, seriesUid, instances);
            }
        }
    },

     /**
     * 載入 URL 中指定的 Instances（當 targetType 為 study 或 series 時）
     */
     async loadSpecifiedInstances(targets, targetType) {
        const specifiedSopUids = this.specifiedSopUid.split(",").map(uid => uid.trim());
        
        if (targetType === "study") {
            for (const target of targets) {
                const studyUid = target.targetId;
                
                // 取得 study 下所有的 series
                const seriesList = await this.fetchStudySeries(studyUid);
                if (!seriesList || seriesList.length === 0) continue;

                for (const series of seriesList) {
                    const seriesUid = series["0020000E"]?.Value?.[0];
                    if (!seriesUid) continue;

                    // 取得 series 下的 instances
                    const instances = await this.fetchSeriesInstances(studyUid, seriesUid);
                    if (!instances || instances.length === 0) continue;

                    // 過濾出指定的 instances
                    const matchedInstances = instances.filter(inst => {
                        const sopUid = inst["00080018"]?.Value?.[0];
                        return sopUid && specifiedSopUids.includes(sopUid);
                    });

                    if (matchedInstances.length > 0) {
                        window.SeriesProgressManager.setTotal(seriesUid, matchedInstances.length);
                        await this.loadFilteredInstances(studyUid, seriesUid, matchedInstances);
                    }
                }
            }
        } else if (targetType === "series") {
            // 對於 series 類型，需要先取得 series 資訊來得知 studyUid
            const seriesListUrl = `${window.location.origin}/api/share/${this.shareToken}/series${this.password ? `?password=${encodeURIComponent(this.password)}` : ""}`;
            
            try {
                const response = await fetch(seriesListUrl);
                if (!response.ok) throw new Error("Failed to fetch series list");
                
                const seriesList = await response.json();
                
                for (const series of seriesList) {
                    const studyUid = series["0020000D"]?.Value?.[0];
                    const seriesUid = series["0020000E"]?.Value?.[0];
                    if (!studyUid || !seriesUid) continue;

                    // 取得 series 下的 instances
                    const instances = await this.fetchSeriesInstances(studyUid, seriesUid);
                    if (!instances || instances.length === 0) continue;

                    // 過濾出指定的 instances
                    const matchedInstances = instances.filter(inst => {
                        const sopUid = inst["00080018"]?.Value?.[0];
                        return sopUid && specifiedSopUids.includes(sopUid);
                    });

                    if (matchedInstances.length > 0) {
                        window.SeriesProgressManager.setTotal(seriesUid, matchedInstances.length);
                        await this.loadFilteredInstances(studyUid, seriesUid, matchedInstances);
                    }
                }
            } catch (error) {
                console.error("Failed to load specified instances:", error);
                showDicomStatus("Error loading instances: " + error.message, true);
            }
        }
    },

    /**
     * 載入過濾後的 instances 列表
     */
    async loadFilteredInstances(studyUid, seriesUid, instances) {
        if (!instances || instances.length === 0) return;

        // 排序：取得最小 Instance Number 的作為首張
        let minInstanceNum = Number.MAX_VALUE;
        let firstInstanceIndex = 0;
        
        for (let i = 0; i < instances.length; i++) {
            const instanceNum = instances[i]["00200013"]?.Value?.[0];
            if (instanceNum !== undefined && instanceNum < minInstanceNum) {
                minInstanceNum = instanceNum;
                firstInstanceIndex = i;
            }
        }

        // 先載入首張影像
        const firstInstance = instances[firstInstanceIndex];
        const firstSopUid = firstInstance["00080018"]?.Value?.[0];
        if (firstSopUid) {
            await this.loadInstanceWadoRs(studyUid, seriesUid, firstSopUid, false);
        }

        // 載入其餘影像
        for (let i = 0; i < instances.length; i++) {
            if (i === firstInstanceIndex) continue;
            
            const sopUid = instances[i]["00080018"]?.Value?.[0];
            if (sopUid) {
                this.loadInstanceWadoRs(studyUid, seriesUid, sopUid, true);
            }
        }
    },

    /**
     * 專門為 share 設計的 WADO-RS loader
     * 類似 viewer.js 的 wadorsLoader，但不需要 ConfigLog 的 token
     */
    shareWadorsLoader(url, onlyload) {
        showDicomStatus("Loading images...");

        LoadFileInBatches.NumOfFetchs++;

        const headers = {
            "user-agent": "Mozilla/4.0 MDN Example",
            "content-type": `multipart/related; type="application/dicom";`,
            "Accept": `multipart/related; type="application/dicom"`
        };

        fetch(url, { headers })
            .then(function (res) {
                if (!res.ok) {
                    console.error("HTTP error:", res.status, res.statusText);
                    showDicomStatus("Error: " + res.status + " " + res.statusText, true);
                    throw new Error("HTTP error " + res.status + ": " + res.statusText);
                }
                return res.arrayBuffer();
            })
            .then(function (resBlob) {
                let decodedBuffers = multipartDecode(resBlob);
                for (let decodedBuf of decodedBuffers) {
                    var Sop = loadDicomDataSet(decodedBuf);
                    setPixelDataToImageObj(Sop);
                    
                    var byteArray = new Uint8Array(decodedBuf);
                    var blob = new Blob([byteArray], { type: "application/dicom" });
                    Sop.Image.url = URL.createObjectURL(blob);

                    if (!(onlyload === true)) {
                        setImageObjToLeft(Sop);
                        resetViewport();
                        GetViewport().loadImgBySop(Sop);
                    } else {
                        leftLayout.refreshNumberOfFramesOrSops(Sop.Image);
                    }
                }
            })
            .catch(function (error) {
                console.error("Fetch error:", error);
                showDicomStatus("Error: " + error.message, true);
            })
            .finally(function () {
                LoadFileInBatches.finishOne(url);
            });
    },

    /**
     * 初始化並載入 share 內容
     */
    async init() {
        if (!this.getShareParams()) {
            return false;
        }

        const shareInfo = await this.fetchShareInfo();
        if (!shareInfo) {
            return false;
        }

        await this.loadByTargetType();
        return true;
    }
};
