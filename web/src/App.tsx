// web/src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import FighterPage from "./pages/Fighter";
import MatchPage from "./pages/Match";
import RecordPage from "./pages/Record";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/fighter/:id" element={<FighterPage />} />
        <Route path="/match/:id" element={<MatchPage />} />
        <Route path="/record" element={<RecordPage />} />
      </Routes>
    </BrowserRouter>
  );
}
