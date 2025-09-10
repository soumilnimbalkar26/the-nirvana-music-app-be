import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { supabase } from "./supabaseClient.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Debug env values (just first few chars, so you know it's loaded)
console.log("Supabase bucket:", process.env.SUPABASE_BUCKET);
console.log("Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log("Mongo URI present:", !!process.env.MONGO_URI);

// MongoDB connect
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

// Song Schema
const songSchema = new mongoose.Schema({
  title: String,
  artist: String,
  duration: Number,
  url: String, // Supabase file URL
});
const Song = mongoose.model("Song", songSchema);

// Multer setup (memory storage for Supabase)
const upload = multer({ storage: multer.memoryStorage() });

// 📌 Get all songs
app.get("/songs", async (req, res) => {
  try {
    const songs = await Song.find();
    res.json(songs);
  } catch (err) {
    console.error("❌ Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch songs" });
  }
});

// 📌 Upload a new song
app.post("/songs", upload.single("song"), async (req, res) => {
  try {
    const { title, artist, duration } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Unique filename for Supabase
    const filename = `${Date.now()}-${file.originalname}`;

    console.log(
      `📤 Uploading file: ${filename} to bucket: ${process.env.SUPABASE_BUCKET}`
    );

    // Upload to Supabase bucket
    const { data: uploadedFile, error: uploadError } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .upload(filename, file.buffer, {
        contentType: file.mimetype,
        upsert: true, // allow overwrite
      });

    if (uploadError) {
      console.error("❌ Supabase upload error:", uploadError);
      return res.status(500).json({
        error: "Supabase upload failed",
        details: uploadError.message,
      });
    }

    console.log("✅ File uploaded to Supabase:", uploadedFile);

    // Get public URL
    const { data: publicData } = supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .getPublicUrl(filename);

    console.log("🌍 Public URL:", publicData.publicUrl);

    // Save song metadata in MongoDB
    const newSong = new Song({
      title,
      artist,
      duration,
      url: publicData.publicUrl,
    });

    await newSong.save();
    console.log("✅ Song metadata saved to MongoDB");

    res.json(newSong);
  } catch (err) {
    console.error("❌ Upload route error:", err);
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
});

//Delete uploaded song
// 📌 Delete a song
app.delete("/songs/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const song = await Song.findByIdAndDelete(id);

    if (!song) {
      return res.status(404).json({ error: "Song not found" });
    }

    // Delete song from Supabase bucket
    const { error: deleteError } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .remove([song.url.split("/").pop()]);

    if (deleteError) {
      console.error("❌ Supabase delete error:", deleteError);
      return res.status(500).json({
        error: "Supabase delete failed",
        details: deleteError.message,
      });
    }

    console.log("✅ Song deleted from Supabase bucket");
    res.json({ message: "Song deleted successfully" });
  } catch (err) {
    console.error("❌ Delete route error:", err);
    res.status(500).json({ error: "Delete failed", details: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Backend running on http://localhost:${PORT}`)
);
