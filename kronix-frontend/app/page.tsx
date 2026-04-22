import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import Features from "@/components/Features";
import KXIBasket from "@/components/KXIBasket";
import Strategies from "@/components/Strategies";
import Trust from "@/components/Trust";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero />
      <Features />
      <Strategies />
      <KXIBasket />
      <Trust />
      <Ticker />
      {/*<Footer />*/}
    </>
  );
}
