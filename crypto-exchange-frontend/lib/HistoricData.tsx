import React, { useEffect, useState } from "react";
import axios from "axios";

type OHLCV = {
  time: string;
  price: number;
};

const SuiHistory: React.FC = () => {
  const [data, setData] = useState<OHLCV[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSuiData = async () => {
      try {
        const response = await axios.get(
          "https://api.coingecko.com/api/v3/coins/sui/market_chart?vs_currency=usd&days=30",
          {
            params: { days: 30 },
          }
        );

        const formattedData = response.data.prices.map(
          (item: [number, number]) => ({
            time: new Date(item[0]).toISOString().split("T")[0],
            price: item[1],
          })
        );

        setData(formattedData);
      } catch (error) {
        console.error("Error fetching SUI data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSuiData();
  }, []);

  return (
    <div className="p-4 text-white">
      <h2 className="text-xl font-bold mb-4">SUI Price (Last 30 Days)</h2>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className="table-auto w-full border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-100 text-black">
              <th className="border p-2">Date</th>
              <th className="border p-2">Price (USD)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry, index) => (
              <tr key={index} className="text-center">
                <td className="border p-2">{entry.time}</td>
                <td className="border p-2">${entry.price.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default SuiHistory;