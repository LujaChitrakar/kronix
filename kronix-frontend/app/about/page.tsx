import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import Features from "@/components/Features";
import KXIBasket from "@/components/KXIBasket";
import Strategies from "@/components/Strategies";
import Trust from "@/components/Trust";

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <Hero />
      <Features />
      <Strategies />
      <KXIBasket />
      <Trust />
      <Ticker />
    </>
  );
}
