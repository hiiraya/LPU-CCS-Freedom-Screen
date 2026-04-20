import { BrowserRouter, Routes, Route } from "react-router-dom";
import Terminal from "./pages/Terminal.jsx";
import Wall from "./pages/Wall.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Terminal />} />
        <Route path="/wall" element={<Wall />} />
      </Routes>
    </BrowserRouter>
  );
}
