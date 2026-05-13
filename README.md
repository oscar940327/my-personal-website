# Oscar's Personal Website

## 介紹
這是一個由 Oscar Cheng 製作的個人網站，展示我的自我介紹、作品集、學習歷程與時間軸。網站採用響應式設計，支援桌機與手機瀏覽，並整合前端互動與 FastAPI 後端 API 串接展示。

網頁展示：https://oscar940327.github.io/my-personal-website/

## 網站結構

- **首頁（index.html）**  
  包含自我介紹、聯絡方式、學經歷與技能簡述。

- **作品集（project_page.html）**  
  展示個人專案，並依照專案性質分成三個區塊：
  - **Featured Projects**：主要展示較完整、較具代表性的作品。
  - **Vibe Coded Projects**：展示以快速實作、概念驗證或 AI 輔助開發為主的作品。
  - **Projects from API**：透過 FastAPI 後端 API 載入並渲染的作品卡片，。

- **時間軸（timeline_page.html）**  
  以垂直時間線方式呈現重要事件，左右交錯顯示，並有美觀的圓點與對話框設計。

- **Header（header.html）**  
  網站導覽列，支援響應式漢堡選單，方便行動裝置瀏覽。

## 技術細節

- **HTML5 / CSS3**  
  使用 Flexbox、Media Query 實現響應式設計。
- **Google Fonts**  
  採用 Poppins 與 Plus Jakarta Sans 字型。
- **JavaScript**  
  用於載入 header 與漢堡選單互動。
- **現代化 UI/UX**  
  卡片式作品展示、陰影、圓角、互動式按鈕與連結。
- **FastAPI API Integration**  
  Projects from API 區塊會從部署於 Render 的 FastAPI 後端取得作品資料，並在前端動態產生 project cards。

## 如何使用

1. 下載本專案所有檔案並放在同一資料夾。
2. 使用瀏覽器開啟 `index.html` 即可瀏覽網站。
3. 點選導覽列可切換至作品集與時間軸頁面。

## 特色

- 支援桌機與手機瀏覽，排版自動調整。
- 作品集依照 Featured Projects、Vibe Coded Projects 與 Projects from API 分區展示。
- Projects from API 區塊會透過後端 API 動態載入作品資料。
- 時間軸事件左右交錯，圓點與對話框設計。
- 漢堡選單支援行動裝置。
- 所有連結均可直接點擊訪問 Demo 或原始碼。

## 聯絡方式

- Email: oscar940327@gmail.com
- GitHub: [oscar940327](https://github.com/oscar940327)

---

> 本網站所有內容與設計皆由 Oscar Cheng 製作，僅供個人學習與展示用途